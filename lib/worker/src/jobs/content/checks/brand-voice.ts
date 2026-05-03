import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";

/**
 * Warn-level check: brand-voice match confidence.
 *
 * Sprint 3 Part 1 ships a **deterministic stub** that approximates a
 * voice-match score from cheap text-shape signals. Part 2 wires this
 * to the LLM-backed voice-library scorer used by the existing
 * /draft pipeline. The scorer is intentionally factored as an async
 * pure function so swapping the implementation is a one-file change.
 *
 * The signal blend (each ∈ [0,1]):
 *   - readability shape:    50–80 char average sentence length is ideal
 *   - vocabulary diversity: type-token ratio above ~0.4 reads natural
 *   - personal pronoun mix: under 2% of words is corporate-tone leaning
 * Mean of the three signals, clamped to [0,1].
 */
export async function runBrandVoiceCheck(
  input: CheckRunInput,
  _log: Logger,
): Promise<CheckRunResult> {
  const threshold = input.threshold ?? 0.7;

  const words = (input.bodyMd.match(/\b[\w'-]+\b/g) ?? []).map((w) => w.toLowerCase());
  if (words.length < 80) {
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: "Brand voice: body too short (<80 words) for confident scoring.",
      details: { reason: "too_short", wordCount: words.length },
    };
  }

  const sentences = (input.bodyMd.match(/[.!?]+(?=\s|$)/g) ?? []).length || 1;
  const avgSentenceLen = words.length / sentences;
  const readabilityScore = scoreInRange(avgSentenceLen, 14, 22, 4);

  const unique = new Set(words).size;
  const ttr = unique / words.length;
  const diversityScore = scoreInRange(ttr, 0.4, 0.7, 0.1);

  const pronouns = words.filter((w) =>
    ["i", "we", "us", "our", "you", "your", "they", "them", "their"].includes(w),
  ).length;
  const pronounRatio = pronouns / words.length;
  const pronounScore = scoreInRange(pronounRatio, 0.01, 0.06, 0.01);

  const score = Math.max(
    0,
    Math.min(1, (readabilityScore + diversityScore + pronounScore) / 3),
  );

  const passed = score >= threshold;
  return {
    outcome: passed ? "pass" : "fail",
    score: Math.round(score * 1000) / 1000,
    threshold,
    summary: passed
      ? `Voice confidence ${(score * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%.`
      : `Voice confidence ${(score * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% — review tone.`,
    details: {
      readabilityScore,
      diversityScore,
      pronounScore,
      avgSentenceLen,
      typeTokenRatio: ttr,
      pronounRatio,
      stub: true,
    },
  };
}

/**
 * Maps `value` against a target band. Inside [center-tol, center+tol] = 1.0.
 * Falls off linearly to 0 as it leaves [low, high]. Used so we don't penalize
 * a value that's slightly above the band any harder than slightly below.
 */
function scoreInRange(value: number, low: number, high: number, tol: number): number {
  const center = (low + high) / 2;
  const dist = Math.abs(value - center);
  const inner = (high - low) / 2 - tol;
  if (dist <= inner) return 1;
  const fall = (high - low) / 2;
  if (dist >= fall) return 0;
  return Math.max(0, 1 - (dist - inner) / (fall - inner));
}
