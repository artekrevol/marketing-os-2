/**
 * Phase 3 pure functions — ContentForge Quality Fix Dispatch v2.
 *
 *  - `computeSerpSignals` (§3.1): scans normalized top-10 SERP results +
 *    brief competitor names and sets the eight required-content flags stored
 *    on `projects.serp_signals`.
 *  - `computeLsiCoverage` (§3.2 / Rule 5.15): given the retrieved LSI terms
 *    and the drafted body, returns the used subset + coverage ratio.
 *
 * Both are deterministic and dependency-free so they unit-test without DataForSEO.
 */
import type { SerpSignals } from "./validators/types.js";

/** Default US metros TekRevol targets (Rule 5.14). Override per brand as needed. */
export const DEFAULT_KNOWN_CITIES = [
  "austin",
  "houston",
  "dallas",
  "chicago",
  "los angeles",
  "new york",
  "san francisco",
  "seattle",
  "miami",
  "atlanta",
  "boston",
  "denver",
  "phoenix",
];

export interface SerpResultLite {
  title?: string;
  description?: string;
  headings?: string[];
  /** true when the result renders structured pricing (price box, $ table). */
  hasPricing?: boolean;
}

export interface SerpSignalInput {
  primaryKeyword: string;
  contentType?: string | null;
  topResults?: SerpResultLite[];
  /** Competitor product/brand names named in the brief. */
  competitorNames?: string[];
  knownCities?: string[];
}

function isCostCluster(keyword: string, contentType?: string | null): boolean {
  return /cost|price|pricing|how much|\brates?\b|budget/i.test(`${keyword} ${contentType || ""}`);
}

function allText(results: SerpResultLite[]): string {
  return results
    .map((r) => `${r.title || ""} ${r.description || ""} ${(r.headings || []).join(" ")}`)
    .join(" \n ")
    .toLowerCase();
}

function allHeadings(results: SerpResultLite[]): string {
  return results.flatMap((r) => r.headings || []).join(" \n ").toLowerCase();
}

export function computeSerpSignals(input: SerpSignalInput): SerpSignals {
  const kw = input.primaryKeyword || "";
  const results = input.topResults || [];
  const competitors = input.competitorNames || [];
  const cities = (input.knownCities || DEFAULT_KNOWN_CITIES).map((c) => c.toLowerCase());
  const cost = isCostCluster(kw, input.contentType);
  const text = allText(results);
  const headings = allHeadings(results);
  const pricingResults = results.filter((r) => r.hasPricing).length;
  const kwLower = kw.toLowerCase();

  return {
    requires_cost_table:
      /cost|price|pricing|how much/i.test(kw) || pricingResults >= 3,
    requires_timeline_table: /how long|timeline|phases?\b/.test(headings),
    requires_regional_comparison:
      /regional|by (?:country|region|location)|geograph|offshore|onshore|nearshore|rates?\s+(?:vary|differ|by)\b/.test(
        text,
      ),
    requires_hourly_rate_comparison:
      cost && /\$\s?\d+\s?(?:\/|per)\s?(?:hr|hour)|hourly\s+rate/.test(text),
    requires_team_model_comparison:
      cost && /in[-\s]?house|\bagency\b|freelancer|outsourc/.test(text),
    requires_maintenance_cost_breakdown:
      cost &&
      /(maintenance[^.]{0,30}(?:%|percent))|((?:%|percent)[^.]{0,30}maintenance)|annual\s+maintenance/.test(
        text,
      ),
    requires_competitor_teardown: competitors.length >= 2,
    requires_local_context: cities.some((c) => kwLower.includes(c)),
  };
}

export interface LsiCoverageResult {
  used: string[];
  retrievedCount: number;
  usedCount: number;
  ratio: number;
}

/** Coverage of retrieved LSI terms within the body (case-insensitive substring). */
export function computeLsiCoverage(
  retrieved: string[],
  bodyText: string,
): LsiCoverageResult {
  const terms = Array.from(
    new Set((retrieved || []).map((t) => (t || "").trim()).filter(Boolean)),
  );
  const hay = (bodyText || "").toLowerCase();
  const used = terms.filter((t) => hay.includes(t.toLowerCase()));
  const ratio = terms.length === 0 ? 0 : used.length / terms.length;
  return {
    used,
    retrievedCount: terms.length,
    usedCount: used.length,
    ratio: Math.round(ratio * 1000) / 1000,
  };
}
