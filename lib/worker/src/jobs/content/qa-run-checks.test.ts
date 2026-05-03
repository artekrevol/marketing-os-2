/**
 * Unit tests for the qa.check_failed / qa.check_errored event split
 * introduced in Part 1.5.
 *
 * The event-row construction is isolated in `buildCheckResultEvent` so
 * it can be tested without standing up Postgres or BullMQ.
 */
import { describe, it, expect } from "vitest";
import { buildCheckResultEvent } from "./qa-run-checks";
import type { CheckRunResult } from "./qa-run-checks";

const COMMON = {
  brandId: "b-1",
  qaRunId: "run-1",
  contentObjectId: "co-1",
  checkName: "brand-voice.confidence" as const,
  severity: "warn" as const,
  checkResultId: "cr-1",
};

describe("buildCheckResultEvent (Part 1.5 event split)", () => {
  it("returns null for outcome=pass (no realtime event emitted)", () => {
    const result: CheckRunResult = {
      outcome: "pass",
      score: 0.9,
      threshold: 0.7,
      summary: "ok",
      details: {},
    };
    expect(buildCheckResultEvent({ ...COMMON, result })).toBeNull();
  });

  it("emits qa.check_failed for outcome=fail with subject=qa_run", () => {
    const result: CheckRunResult = {
      outcome: "fail",
      score: 0.4,
      threshold: 0.7,
      summary: "below threshold",
      details: { reason: "low_score" },
    };
    const evt = buildCheckResultEvent({ ...COMMON, result });
    expect(evt).not.toBeNull();
    expect(evt!.eventType).toBe("qa.check_failed");
    expect(evt!.subjectType).toBe("qa_run");
    expect(evt!.subjectId).toBe("run-1");
    expect(evt!.payload).toMatchObject({
      contentObjectId: "co-1",
      checkName: "brand-voice.confidence",
      severity: "warn",
      outcome: "fail",
      score: 0.4,
      threshold: 0.7,
    });
  });

  it("emits qa.check_errored (NOT qa.check_failed) for outcome=error", () => {
    const result: CheckRunResult = {
      outcome: "error",
      score: null,
      threshold: 0.7,
      summary: "Brand voice: OpenAI call timed out after 3 attempts.",
      details: {
        error: "timeout",
        attempts: 3,
        errorClass: "OpenAITimeoutError",
      },
    };
    const evt = buildCheckResultEvent({ ...COMMON, result });
    expect(evt).not.toBeNull();
    expect(evt!.eventType).toBe("qa.check_errored");
    expect(evt!.eventType).not.toBe("qa.check_failed");
    expect(evt!.subjectType).toBe("qa_check_result");
    expect(evt!.subjectId).toBe("cr-1");
    expect(evt!.payload).toMatchObject({
      sourceService: "worker",
      qaRunId: "run-1",
      contentObjectId: "co-1",
      checkName: "brand-voice.confidence",
      severity: "warn",
      errorClass: "OpenAITimeoutError",
      attempts: 3,
      error: "timeout",
    });
  });

  it("qa.check_errored payload defaults errorClass/attempts to null when details are bare", () => {
    const result: CheckRunResult = {
      outcome: "error",
      score: null,
      threshold: null,
      summary: "brand_not_found",
      details: { error: "brand_not_found" },
    };
    const evt = buildCheckResultEvent({ ...COMMON, result });
    expect(evt!.payload).toMatchObject({
      errorClass: null,
      attempts: null,
      error: "brand_not_found",
    });
  });

  it("qa.check_errored carries a null subjectId when the row insert returned no id", () => {
    const result: CheckRunResult = {
      outcome: "error",
      score: null,
      threshold: 0.7,
      summary: "x",
      details: {},
    };
    const evt = buildCheckResultEvent({
      ...COMMON,
      checkResultId: null,
      result,
    });
    expect(evt!.eventType).toBe("qa.check_errored");
    expect(evt!.subjectId).toBeNull();
  });
});
