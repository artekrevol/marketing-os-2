import { eq, and, inArray, sql } from "drizzle-orm";
import {
  withBrandScope,
  contentObjectsTable,
  qaRunsTable,
  qaSignoffsTable,
  eventsTable,
  type ContentObject,
  type QaRun,
} from "@workspace/db";
import { enqueue } from "@workspace/jobs";
import {
  type SubmitForReviewInput,
  type DecideInput,
  SubmitForReviewInputSchema,
  DecideInputSchema,
  type ContentStatus,
} from "./types";
import {
  ContentObjectNotFoundError,
  MissingCommentError,
  NotImplementedError,
  InvalidTransitionError,
} from "./errors";
import { assertTransition, statusFromQaRun } from "./state-machine";

/**
 * Submit a content_object for review.
 *
 * Idempotency: a partial unique index on
 *   qa_runs(content_object_id) WHERE status IN ('queued','running')
 * (see migration 0006_qa_runs_idempotency.sql) makes "two writers click
 * Submit at the same time" safe at the DB level. The second insert
 * fails with a unique-violation; we catch it and return the existing
 * in-flight run instead of creating a duplicate. The state machine
 * still rejects re-submitting an already-submitted object, so the
 * caller sees a deterministic outcome.
 */
export async function submitForReview(
  raw: SubmitForReviewInput,
): Promise<{ contentObjectId: string; qaRunId: string; idempotencyKey: string }> {
  const input = SubmitForReviewInputSchema.parse(raw);

  const qaRunId = await withBrandScope(input.brandId, async ({ scoped, db }) => {
    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, input.contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0];

    if (!obj) throw new ContentObjectNotFoundError(input.contentObjectId);

    // If an in-flight run already exists for this object, surface it
    // without creating a second row — handles the double-press case
    // even before the unique index trips.
    if (obj.status === "submitted") {
      const inflight = (await scoped.select(qaRunsTable, {
        where: and(
          eq(qaRunsTable.contentObjectId, input.contentObjectId),
          inArray(qaRunsTable.status, ["queued", "running"]),
        )!,
        limit: 1,
      })) as QaRun[];
      if (inflight[0]) return inflight[0].id;
      // Submitted but no in-flight run — treat as a re-kick. Fall
      // through to the insert below; the state machine assertion is
      // skipped because we're not transitioning the status field.
    } else {
      assertTransition(obj.status as ContentStatus, "submitted");
      await scoped.update(
        contentObjectsTable,
        {
          status: "submitted",
          submittedAt: new Date(),
          submittedBy: input.actorId,
          updatedAt: new Date(),
        },
        eq(contentObjectsTable.id, input.contentObjectId),
      );
    }

    let runId: string;
    try {
      const inserted = (await scoped.insert(
        qaRunsTable,
        {
          contentObjectId: input.contentObjectId,
          status: "queued",
          triggeredBy: input.actorId,
        },
        { returning: true },
      )) as Array<{ id: string }>;
      runId = inserted[0]!.id;
    } catch (err) {
      // unique_violation on (content_object_id, status in queued|running)
      if ((err as { code?: string }).code === "23505") {
        const inflight = (await scoped.select(qaRunsTable, {
          where: and(
            eq(qaRunsTable.contentObjectId, input.contentObjectId),
            inArray(qaRunsTable.status, ["queued", "running"]),
          )!,
          limit: 1,
        })) as QaRun[];
        if (!inflight[0]) throw err; // unrecoverable — re-throw original
        return inflight[0].id;
      }
      throw err;
    }

    await db.insert(eventsTable).values({
      brandId: input.brandId,
      actorId: input.actorId,
      eventType: "content_object.submitted",
      subjectType: "content_object",
      subjectId: input.contentObjectId,
      payload: { qaRunId: runId, contentObjectId: input.contentObjectId },
    });

    return runId;
  });

  // Enqueue outside the transaction. BullMQ jobId == qa_run.id makes
  // a double-press idempotent at the queue layer too.
  await enqueue("content.qa-run-checks", {
    idempotencyKey: qaRunId,
    brandId: input.brandId,
    qaRunId,
    contentObjectId: input.contentObjectId,
  });

  return { contentObjectId: input.contentObjectId, qaRunId, idempotencyKey: qaRunId };
}

/**
 * Reviewer decision: approves or rejects the content_object.
 */
export async function decide(
  raw: DecideInput,
): Promise<{ qaSignoffId: string; status: ContentStatus }> {
  const input = DecideInputSchema.parse(raw);
  if (input.decision === "rejected" && !(input.comment ?? "").trim()) {
    throw new MissingCommentError();
  }

  return withBrandScope(input.brandId, async ({ scoped, db }) => {
    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, input.contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0];
    if (!obj) throw new ContentObjectNotFoundError(input.contentObjectId);

    // Only in_review is decidable. submitted is pre-QA — refuse.
    if (obj.status !== "in_review") {
      throw new InvalidTransitionError(obj.status as ContentStatus, input.decision);
    }
    assertTransition(obj.status as ContentStatus, input.decision);

    const inserted = (await scoped.insert(
      qaSignoffsTable,
      {
        contentObjectId: input.contentObjectId,
        reviewerId: input.reviewerId,
        decision: input.decision,
        comment: input.comment ?? null,
      },
      { returning: true },
    )) as Array<{ id: string }>;
    const signoffId = inserted[0]!.id;

    await scoped.update(
      contentObjectsTable,
      {
        status: input.decision,
        decidedAt: new Date(),
        decidedBy: input.reviewerId,
        decisionComment: input.comment ?? null,
        updatedAt: new Date(),
      },
      eq(contentObjectsTable.id, input.contentObjectId),
    );

    await db.insert(eventsTable).values({
      brandId: input.brandId,
      actorId: input.reviewerId,
      eventType: "content_object.decided",
      subjectType: "content_object",
      subjectId: input.contentObjectId,
      payload: {
        decision: input.decision,
        qaSignoffId: signoffId,
        comment: input.comment ?? null,
      },
    });

    return { qaSignoffId: signoffId, status: input.decision };
  });
}

/**
 * Worker-side: called from content.qa-run-checks after all checks
 * have been recorded. Atomically transitions qa_runs.status and
 * content_objects.status.
 */
export async function finalizeQaRun(args: {
  brandId: string;
  qaRunId: string;
  contentObjectId: string;
  qaStatus: "passed" | "failed" | "error";
  durationMs: number;
  summary: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  const next = statusFromQaRun(args.qaStatus);
  await withBrandScope(args.brandId, async ({ scoped, db }) => {
    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, args.contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0];
    if (!obj) throw new ContentObjectNotFoundError(args.contentObjectId);

    if (obj.status === "submitted") {
      assertTransition("submitted", next);
      await scoped.update(
        contentObjectsTable,
        { status: next, updatedAt: new Date() },
        eq(contentObjectsTable.id, args.contentObjectId),
      );
    }

    await scoped.update(
      qaRunsTable,
      {
        status: args.qaStatus,
        completedAt: new Date(),
        durationMs: args.durationMs,
        summary: args.summary,
        errorMessage: args.errorMessage ?? null,
      },
      eq(qaRunsTable.id, args.qaRunId),
    );

    await db.insert(eventsTable).values({
      brandId: args.brandId,
      eventType: "qa_run.completed",
      subjectType: "qa_run",
      subjectId: args.qaRunId,
      payload: {
        contentObjectId: args.contentObjectId,
        qaStatus: args.qaStatus,
        durationMs: args.durationMs,
        summary: args.summary,
      },
    });

    if (args.qaStatus === "passed" && obj.status === "submitted") {
      await db.insert(eventsTable).values({
        brandId: args.brandId,
        eventType: "content_object.entered_review",
        subjectType: "content_object",
        subjectId: args.contentObjectId,
        payload: { qaRunId: args.qaRunId },
      });
    }
  });
}

/**
 * Sprint 3 Part 1 ships read-only override visibility; the modal
 * lands in Part 2.
 */
export async function overrideHardFail(): Promise<never> {
  throw new NotImplementedError("override modal");
}

// Silence unused import for sql — kept for future raw-SQL escape hatches.
void sql;
