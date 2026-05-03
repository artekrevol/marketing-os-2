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
 *   4. Execute every enabled runner serially, persisting one
 *      qa_check_results row per check (even on individual error).
 *   5. Hard-fail check failures → qa_run.status='failed'.
 *      Otherwise (including warns) → qa_run.status='passed'.
 *      Handler crash → qa_run.status='error', re-thrown for retry.
 *   6. finalizeQaRun() transitions content_object.status atomically.
 *
 * Runs serially so a single Originality.ai API failure can short-
 * circuit the rest. The state machine accepts failures gracefully:
 * the bouncing back to 'drafting' lets the writer iterate.
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
  let hardFailed = false;
  let warnFailed = 0;
  let executed = 0;
  let crashCount = 0;

  for (const [checkName, runner] of Object.entries(RUNNERS) as [CheckName, CheckRunner][]) {
    const def = defs.get(checkName);
    if (!def) {
      log.warn({ checkName, brandId: payload.brandId }, "qa-run-checks: no definition for check, skipping");
      continue;
    }

    const checkStart = Date.now();
    let result: CheckRunResult;
    try {
      result = await runner(
        {
          brandId: payload.brandId,
          contentObjectId: payload.contentObjectId,
          bodyMd: obj.bodyMd,
          wordCount: obj.wordCount,
          threshold: def.threshold ? Number(def.threshold) : null,
          config: (def.config as Record<string, unknown>) ?? {},
        },
        log.child({ checkName }),
      );
    } catch (err) {
      log.error({ err, checkName }, "qa-run-checks: runner threw");
      result = {
        outcome: "error",
        score: null,
        threshold: def.threshold ? Number(def.threshold) : null,
        summary: (err as Error).message ?? "runner crashed",
        details: { error: (err as Error).message ?? "unknown" },
      };
      crashCount += 1;
    }

    executed += 1;

    await withBrandScope(payload.brandId, async ({ scoped }) => {
      await scoped.insert(qaCheckResultsTable, {
        qaRunId: payload.qaRunId,
        checkName,
        severity: def.severity as CheckSeverity,
        outcome: result.outcome,
        score: result.score === null ? null : result.score.toString(),
        threshold: result.threshold === null ? null : result.threshold.toString(),
        summary: result.summary,
        details: result.details,
        durationMs: Date.now() - checkStart,
      });
    });

    if (result.outcome === "fail") {
      if (def.severity === "hard") hardFailed = true;
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
