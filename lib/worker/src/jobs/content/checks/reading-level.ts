import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";

/**
 * Warn-level check: Flesch–Kincaid grade level.
 *
 * Brand definition stores `threshold` as the target grade and
 * `config.tolerance` as the absolute Δ allowed before warning.
 *
 *   target=9, tolerance=2  → warn if |grade - 9| > 2
 *
 * No third-party call — pure-string analysis on the markdown body
 * (we strip code fences and link/image syntax for a more accurate
 * sentence + syllable count).
 */
export async function runReadingLevelCheck(
  input: CheckRunInput,
  _log: Logger,
): Promise<CheckRunResult> {
  const target = input.threshold ?? 9;
  const tolerance = Number((input.config as { tolerance?: number }).tolerance ?? 2);

  const text = stripMarkdown(input.bodyMd);
  if (text.trim().length === 0) {
    return {
      outcome: "fail",
      score: null,
      threshold: target,
      summary: "Reading level: body is empty after stripping markdown.",
      details: { reason: "empty_body" },
    };
  }

  const sentences = countSentences(text);
  const words = countWords(text);
  const syllables = countSyllables(text);
  if (sentences === 0 || words === 0) {
    return {
      outcome: "fail",
      score: null,
      threshold: target,
      summary: "Reading level: not enough sentences/words to compute.",
      details: { sentences, words, syllables },
    };
  }

  // Flesch-Kincaid Grade = 0.39*(words/sentences) + 11.8*(syllables/words) - 15.59
  const grade =
    0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  const rounded = Math.round(grade * 10) / 10;
  const within = Math.abs(rounded - target) <= tolerance;

  return {
    outcome: within ? "pass" : "fail",
    score: rounded,
    threshold: target,
    summary: within
      ? `Flesch–Kincaid grade ${rounded} within ±${tolerance} of target ${target}.`
      : `Flesch–Kincaid grade ${rounded} is more than ±${tolerance} away from target ${target}.`,
    details: { sentences, words, syllables, tolerance },
  };
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(?=\s|$)/g);
  return matches ? matches.length : 0;
}

function countWords(text: string): number {
  const matches = text.match(/\b[\w'-]+\b/g);
  return matches ? matches.length : 0;
}

function countSyllables(text: string): number {
  const words = text.toLowerCase().match(/\b[a-z'-]+\b/g) ?? [];
  let total = 0;
  for (const w of words) total += syllablesInWord(w);
  return total;
}

function syllablesInWord(word: string): number {
  if (word.length <= 3) return 1;
  const w = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/i, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
