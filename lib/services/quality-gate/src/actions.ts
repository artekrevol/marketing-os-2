import { eq, and, inArray, desc, sql } from "drizzle-orm";
import {
  withBrandScope,
  contentObjectsTable,
  qaRunsTable,
  qaSignoffsTable,
  qaOverridesTable,
  draftsTable,
  projectsTable,
  eventsTable,
  auditLogTable,
  type ContentObject,
  type Draft,
  type Project,
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
import type { DbClient } from "@workspace/db";

/**
 * Acquire a row-level lock on `content_objects` for the duration of
 * the surrounding transaction. Two writers calling submit/decide on
 * the same object will serialize through this lock so the state
 * machine assertion always reads the post-commit value of the prior
 * transition. Returns true if the row exists.
 */
async function lockContentObject(
  tx: DbClient,
  brandId: string,
  contentObjectId: string,
): Promise<boolean> {
  const result = (await tx.execute(
    sql`select 1 from public.content_objects
        where id = ${contentObjectId}::uuid
          and brand_id = ${brandId}::uuid
        for update`,
  )) as unknown as { rows?: unknown[] } | unknown[];
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return rows.length > 0;
}

/**
 * Submit a content_object for review.
 *
 * Idempotency: a partial unique index on
 *   qa_runs(content_object_id) WHERE status IN ('queued','running')
 * (see migration 0006_qa_runs_idempotency.sql) makes "two writers click
 * Submit at the same time" safe at the DB level. The second insert
 * fails with a unique-violation; we catch it and return the existing
 * in-flight run instead of creating a duplicate. We additionally
 * SELECT … FOR UPDATE the content_objects row to serialize state-
 * machine reads against concurrent decide() / finalizeQaRun() calls.
 */
export async function submitForReview(
  raw: SubmitForReviewInput,
): Promise<{ contentObjectId: string; qaRunId: string; idempotencyKey: string }> {
  const input = SubmitForReviewInputSchema.parse(raw);

  const qaRunId = await withBrandScope(input.brandId, async ({ scoped, db }) => {
    const exists = await lockContentObject(db, input.brandId, input.contentObjectId);
    if (!exists) throw new ContentObjectNotFoundError(input.contentObjectId);

    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, input.contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0]!;

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
 * Acquires SELECT … FOR UPDATE on the row before reading status, and
 * writes a parallel `audit_log` entry alongside the qa_signoff so
 * admin actions remain auditable independent of the events stream.
 */
export async function decide(
  raw: DecideInput,
): Promise<{ qaSignoffId: string; status: ContentStatus }> {
  const input = DecideInputSchema.parse(raw);
  if (input.decision === "rejected" && !(input.comment ?? "").trim()) {
    throw new MissingCommentError();
  }

  return withBrandScope(input.brandId, async ({ scoped, db }) => {
    const exists = await lockContentObject(db, input.brandId, input.contentObjectId);
    if (!exists) throw new ContentObjectNotFoundError(input.contentObjectId);

    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, input.contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0]!;

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

    // Mandatory audit_log row for any reviewer decision. The
    // justification column has a non-empty CHECK constraint, so we
    // fall back to a stable phrase when the reviewer skipped the
    // optional comment on an approval.
    await db.insert(auditLogTable).values({
      brandId: input.brandId,
      actorId: input.reviewerId,
      action: input.decision === "approved" ? "qa.approve" : "qa.reject",
      targetType: "content_object",
      targetId: input.contentObjectId,
      justification: (input.comment ?? "").trim() || `reviewer ${input.decision}`,
      metadata: { qaSignoffId: signoffId },
    });

    return { qaSignoffId: signoffId, status: input.decision };
  });
}

/**
 * Convenience wrapper exposing the approval path as a named action.
 * Required by the sprint contract; functionally a thin proxy over
 * `decide({ decision: "approved" })`.
 */
export async function approveQaRun(
  input: Omit<DecideInput, "decision">,
): Promise<{ qaSignoffId: string; status: ContentStatus }> {
  return decide({ ...input, decision: "approved" });
}

/**
 * Convenience wrapper for the rejection / revision-request path.
 * Forces a non-empty comment by leaning on the same MissingCommentError
 * branch the generic decide() has.
 */
export async function requestRevision(
  input: Omit<DecideInput, "decision">,
): Promise<{ qaSignoffId: string; status: ContentStatus }> {
  return decide({ ...input, decision: "rejected" });
}

/**
 * Worker-side: called from content.qa-run-checks after all checks
 * have been recorded. Atomically transitions qa_runs.status and
 * content_objects.status under SELECT … FOR UPDATE so concurrent
 * submit/decide cannot read a stale snapshot.
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
    const exists = await lockContentObject(db, args.brandId, args.contentObjectId);
    if (!exists) throw new ContentObjectNotFoundError(args.contentObjectId);

    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, args.contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0]!;

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
      eventType: "qa.run_completed",
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
 * ContentForge convenience: materialize a `content_object` from the
 * latest draft in a project, or surface the existing in-flight one
 * if a `drafting` content_object is already attached.
 *
 * Lives in the service layer (NOT the api-server) so the only writer
 * of `content_objects` rows remains @workspace/quality-gate. All
 * writes go through the brand-scoped `scoped.insert` helper.
 */
export async function startFromDraft(args: {
  brandId: string;
  projectId: string;
  actorId: string;
}): Promise<{ contentObjectId: string; source: "created" | "reused" }> {
  return withBrandScope(args.brandId, async ({ scoped }) => {
    const existing = (await scoped.select(contentObjectsTable, {
      where: and(
        eq(contentObjectsTable.projectId, args.projectId),
        eq(contentObjectsTable.status, "drafting"),
      )!,
      orderBy: desc(contentObjectsTable.createdAt),
      limit: 1,
    })) as ContentObject[];
    if (existing[0]) {
      return { contentObjectId: existing[0].id, source: "reused" as const };
    }

    const drafts = (await scoped.select(draftsTable, {
      where: eq(draftsTable.projectId, args.projectId),
      orderBy: [desc(draftsTable.updatedAt), desc(draftsTable.createdAt)],
      limit: 1,
    })) as Draft[];
    const draft = drafts[0];

    const projects = (await scoped.select(projectsTable, {
      where: eq(projectsTable.id, args.projectId),
      limit: 1,
    })) as Project[];
    const project = projects[0];

    const inserted = (await scoped.insert(
      contentObjectsTable,
      {
        projectId: args.projectId,
        draftId: draft?.id ?? null,
        title: project?.topic ?? "",
        bodyMd: draft?.bodyMd ?? "",
        wordCount: draft?.wordCount ?? 0,
        status: "drafting",
      },
      { returning: true },
    )) as Array<{ id: string }>;
    return { contentObjectId: inserted[0]!.id, source: "created" as const };
  });
}

/**
 * Sprint 3 Part 1 ships read-only override visibility. The full
 * override modal (write path on `qa_overrides` + corresponding
 * audit_log entry, hard-fail-only enforcement, mandatory reason)
 * lands in Part 2.
 */
export async function overrideQaRun(): Promise<never> {
  // Reference unused imports kept for Part 2 to silence TS without
  // changing the public surface ahead of time.
  void qaOverridesTable;
  throw new NotImplementedError("override modal");
}
export const overrideHardFail = overrideQaRun;
