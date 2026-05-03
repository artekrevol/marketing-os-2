import { eq } from "drizzle-orm";
import {
  withBrandScope,
  qaRunsTable,
  qaCheckResultsTable,
  eventsTable,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import {
  finalizeQaRun,
  getCheckDefinitions,
  getContentObjectForChecks,
  type CheckName,
  type CheckOutcome,
  type CheckSeverity,
} from "@workspace/quality-gate";
import type { Logger } from "pino";
import { assertNotDuplicate } from "../idempotency";
import { runOriginalityCheck } from "./checks/originality";
import { runReadingLevelCheck } from "./checks/reading-level";
import { runBrandVoiceCheck } from "./checks/brand-voice";
import { runBriefComplianceCheck } from "./checks/brief-compliance";

const SUCCESS_EVENT = "qa_run.checks_completed";

export interface CheckRunInput {
  brandId: string;
  contentObjectId: string;
  bodyMd: string;
  wordCount: number;
  threshold: number | null;
  config: Record<string, unknown>;
}

export interface CheckRunResult {
  outcome: CheckOutcome;
  score: number | null;
  threshold: number | null;
  summary: string;
  details: Record<string, unknown>;
}

type CheckRunner = (input: CheckRunInput, log: Logger) => Promise<CheckRunResult>;

const RUNNERS: Record<CheckName, CheckRunner> = {
  "originality.ai-score": runOriginalityCheck,
  "reading-level.flesch-grade": runReadingLevelCheck,
  "brand-voice.confidence": runBrandVoiceCheck,
  "brief-compliance.coverage": runBriefComplianceCheck,
};

/**
 * Quality-gate worker. Per qa_run:
 *   1. Idempotency guard (qa_run.id is the key).
 *   2. Mark qa_runs.status='running'.
 *   3. Load content_object + per-brand check definitions.
 *   4. Execute every enabled runner in PARALLEL via Promise.allSettled
 *      so a slow Originality.ai call cannot block the warns. Each
 *      result is persisted regardless of outcome (errors recorded
 *      with outcome='error').
 *   5. Per failed check, emit a `qa.check_failed` event so the UI
 *      can react in realtime. Hard-fail check failures => qa_run.status='failed'.
 *      Otherwise (including warns) => qa_run.status='passed'.
 *      Handler crash => qa_run.status='error', re-thrown for retry.
 *   6. finalizeQaRun() emits the terminal `qa.run_completed` event
 *      and atomically transitions content_object.status.
 */
export async function handleQaRunChecks(
  payload: JobData<"content.qa-run-checks">,
  log: Logger,
): Promise<{ qaStatus: "passed" | "failed" | "error"; checks: number; duplicate?: true }> {
  const dup = await assertNotDuplicate(SUCCESS_EVENT, payload.idempotencyKey, log);
  if (dup.duplicate) return { qaStatus: "passed", checks: 0, duplicate: true };

  const startedAt = Date.now();

  await withBrandScope(payload.brandId, async ({ scoped }) => {
    await scoped.update(
      qaRunsTable,
      { status: "running", startedAt: new Date() },
      eq(qaRunsTable.id, payload.qaRunId),
    );
  });

  const obj = await getContentObjectForChecks(payload.brandId, payload.contentObjectId);
  if (!obj) {
    const msg = `qa-run-checks: content_object ${payload.contentObjectId} not found`;
    log.error({ contentObjectId: payload.contentObjectId }, msg);
    await finalizeQaRun({
      brandId: payload.brandId,
      qaRunId: payload.qaRunId,
      contentObjectId: payload.contentObjectId,
      qaStatus: "error",
      durationMs: Date.now() - startedAt,
      summary: { reason: "content_object_missing" },
      errorMessage: msg,
    });
    return { qaStatus: "error", checks: 0 };
  }

  const defs = await getCheckDefinitions(payload.brandId);

  type Slot = {
    checkName: CheckName;
    severity: CheckSeverity;
    threshold: number | null;
    config: Record<string, unknown>;
    startedAt: number;
  };
  const slots: Slot[] = [];
  const promises: Promise<CheckRunResult>[] = [];

  for (const [checkName, runner] of Object.entries(RUNNERS) as [CheckName, CheckRunner][]) {
    const def = defs.get(checkName);
    if (!def) {
      log.warn(
        { checkName, brandId: payload.brandId },
        "qa-run-checks: no definition for check, skipping",
      );
      continue;
    }
    const threshold = def.threshold ? Number(def.threshold) : null;
    slots.push({
      checkName,
      severity: def.severity as CheckSeverity,
      threshold,
      config: (def.config as Record<string, unknown>) ?? {},
      startedAt: Date.now(),
    });
    promises.push(
      runner(
        {
          brandId: payload.brandId,
          contentObjectId: payload.contentObjectId,
          bodyMd: obj.bodyMd,
          wordCount: obj.wordCount,
          threshold,
          config: (def.config as Record<string, unknown>) ?? {},
        },
        log.child({ checkName }),
      ),
    );
  }

  const settled = await Promise.allSettled(promises);

  let hardFailed = false;
  let warnFailed = 0;
  let executed = 0;
  let crashCount = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const settledResult = settled[i]!;
    let result: CheckRunResult;
    if (settledResult.status === "fulfilled") {
      result = settledResult.value;
    } else {
      const err = settledResult.reason as Error;
      log.error({ err, checkName: slot.checkName }, "qa-run-checks: runner threw");
      result = {
        outcome: "error",
        score: null,
        threshold: slot.threshold,
        summary: err?.message ?? "runner crashed",
        details: { error: err?.message ?? "unknown" },
      };
      crashCount += 1;
    }

    executed += 1;

    await withBrandScope(payload.brandId, async ({ scoped, db }) => {
      await scoped.insert(qaCheckResultsTable, {
        qaRunId: payload.qaRunId,
        checkName: slot.checkName,
        severity: slot.severity,
        outcome: result.outcome,
        score: result.score === null ? null : result.score.toString(),
        threshold: result.threshold === null ? null : result.threshold.toString(),
        summary: result.summary,
        details: result.details,
        durationMs: Date.now() - slot.startedAt,
      });

      // Realtime fan-out: surface every fail/error as a discrete
      // event so the seo-os queue can flag the run before the
      // terminal `qa.run_completed` lands.
      if (result.outcome !== "pass") {
        await db.insert(eventsTable).values({
          brandId: payload.brandId,
          eventType: "qa.check_failed",
          subjectType: "qa_run",
          subjectId: payload.qaRunId,
          payload: {
            contentObjectId: payload.contentObjectId,
            checkName: slot.checkName,
            severity: slot.severity,
            outcome: result.outcome,
            score: result.score,
            threshold: result.threshold,
            summary: result.summary,
          },
        });
      }
    });

    if (result.outcome === "fail") {
      if (slot.severity === "hard") hardFailed = true;
      else warnFailed += 1;
    }
  }

  const qaStatus: "passed" | "failed" | "error" =
    crashCount > 0 && executed === crashCount
      ? "error"
      : hardFailed
        ? "failed"
        : "passed";

  const summary = {
    executed,
    hardFailed,
    warns: warnFailed,
    crashCount,
    title: obj.title,
    wordCount: obj.wordCount,
  };

  await finalizeQaRun({
    brandId: payload.brandId,
    qaRunId: payload.qaRunId,
    contentObjectId: payload.contentObjectId,
    qaStatus,
    durationMs: Date.now() - startedAt,
    summary,
  });

  // Idempotency event — recorded last so a re-run of an already-completed
  // qa_run is a no-op. Uses the BullMQ jobId (== qa_run.id) as the key.
  await withBrandScope(payload.brandId, async ({ db }) => {
    await db.insert(eventsTable).values({
      brandId: payload.brandId,
      eventType: SUCCESS_EVENT,
      subjectType: "qa_run",
      subjectId: payload.qaRunId,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        contentObjectId: payload.contentObjectId,
        qaStatus,
        ...summary,
      },
    });
  });

  log.info({ qaRunId: payload.qaRunId, qaStatus, summary }, "qa-run-checks: done");
  return { qaStatus, checks: executed };
}
