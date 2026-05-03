import { OriginalityAIClient } from "@workspace/integrations-originality-ai";
import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";

/**
 * Hard-fail check: Originality.ai AI-detector score.
 *
 * `score` is the AI-score percent reported by the API (0..100). The
 * threshold is the brand-specific *maximum* AI-score allowed:
 *   - TekRevol, Reverto      = 20
 *   - ClaimShield, CensusFlow = 15
 *
 * Originality returns `aiScore` in [0,1]; we multiply by 100 so the
 * threshold maths in the brand definition matches the per-brand spec.
 *
 * Verification failure (network error, missing scanId) = hard fail
 * (qa_run.status='failed'). Per Sprint 3 D-policy: never silently
 * pass through a failed scan.
 */
export async function runOriginalityCheck(
  input: CheckRunInput,
  log: Logger,
): Promise<CheckRunResult> {
  const threshold = input.threshold ?? 20;

  if (!input.bodyMd || input.bodyMd.trim().length < 50) {
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: "Originality scan refused: body is empty or too short (<50 chars).",
      details: { reason: "body_too_short", wordCount: input.wordCount },
    };
  }

  let client: OriginalityAIClient;
  try {
    client = new OriginalityAIClient({ brandId: input.brandId });
  } catch (err) {
    log.error({ err }, "originality check: client init failed");
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: `Originality client unavailable: ${(err as Error).message}`,
      details: { reason: "client_init_failed", error: (err as Error).message },
    };
  }

  let res;
  try {
    res = await client.scanText(input.bodyMd);
  } catch (err) {
    log.error({ err }, "originality check: scan threw");
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: `Originality scan failed: ${(err as Error).message}`,
      details: { reason: "scan_failed", error: (err as Error).message },
    };
  }

  if (res.aiScore === null || res.scanId === null) {
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: "Originality scan returned no AI score or scan id.",
      details: { reason: "missing_score", scanId: res.scanId, aiScore: res.aiScore },
    };
  }

  // API returns 0..1; convert to percent so the threshold matches spec.
  const aiPercent = Math.round(res.aiScore * 1000) / 10;
  const passed = aiPercent <= threshold;

  return {
    outcome: passed ? "pass" : "fail",
    score: aiPercent,
    threshold,
    summary: passed
      ? `AI-score ${aiPercent}% ≤ threshold ${threshold}%.`
      : `AI-score ${aiPercent}% exceeds threshold ${threshold}%. Rewrite required.`,
    details: {
      scanId: res.scanId,
      aiScore: res.aiScore,
      plagiarismScore: res.plagiarismScore,
      publicLink: res.publicLink,
      creditsUsed: res.creditsUsed,
    },
  };
}
