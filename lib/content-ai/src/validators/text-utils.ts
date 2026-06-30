/**
 * Shared, dependency-free text helpers for the validators. Kept pure so the
 * structural checks (heading hygiene, brand ratio, repetition, etc.) are fully
 * unit-testable without a DB or network.
 */

/** Dollar-amount pattern used by case-study / aggregate-financial gates. */
export const DOLLAR_RE = /\$\s?\d[\d,]*(?:\.\d+)?/;

/** Strip markdown link syntax to the visible anchor text, drop heading/list marks. */
export function stripMarkdown(md: string): string {
  return (md || "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_`>]/g, "");
}

/** Naive sentence splitter — good enough for ratio/answer counting. */
export function splitSentences(text: string): string[] {
  const clean = stripMarkdown(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Paragraphs (blank-line separated), markdown intact. */
export function splitParagraphs(text: string): string[] {
  return (text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return stripMarkdown(text).split(/\s+/).filter(Boolean).length;
}

export function firstNWords(text: string, n: number): string {
  return stripMarkdown(text).split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

/** Case-insensitive substring presence of `kw` in `text`. */
export function containsKeyword(text: string, kw: string): boolean {
  if (!kw) return false;
  return stripMarkdown(text).toLowerCase().includes(kw.trim().toLowerCase());
}

export interface Heading {
  level: 1 | 2 | 3;
  text: string;
}

/** Parse ATX markdown headings (#, ##, ###) from the body. */
export function parseHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  for (const line of (md || "").split("\n")) {
    const m = /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    out.push({ level: m[1]!.length as 1 | 2 | 3, text: m[2]!.trim() });
  }
  return out;
}

/** Split the body into sections keyed by H2 heading (text before first H2 is "intro"). */
export function splitSectionsByH2(md: string): Array<{ heading: string; body: string }> {
  const lines = (md || "").split("\n");
  const sections: Array<{ heading: string; body: string }> = [];
  let current = { heading: "intro", body: [] as string[] };
  for (const line of lines) {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    if (m && !/^###/.test(line)) {
      sections.push({ heading: current.heading, body: current.body.join("\n") });
      current = { heading: m[1]!.trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push({ heading: current.heading, body: current.body.join("\n") });
  return sections.filter((s) => s.body.trim() || s.heading !== "intro");
}

/** Numbers appearing in text (commas stripped), for ±5% citation matching. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of (text || "").matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0]!.replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Normalize a host for whitelist comparison (lowercase, strip www). */
export function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return (url || "").toLowerCase().replace(/^www\./, "");
  }
}

/** Normalize project / company names for set membership. */
export function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|co|corp|company)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
