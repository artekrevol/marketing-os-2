/**
 * Citation validators — Phase 6.3 (live URL verification of every statistic),
 * Phase 5.5 (authority floor ≥2 whitelisted citations), and inline stale-stat
 * flagging. URL fetching is injected (`ctx.deps.fetchUrl`) so content-ai keeps
 * no direct DataForSEO / HTTP dependency.
 */
import type { CheckResult, StatisticUsed, StrippedItem, ValidatorContext } from "./types.js";
import { extractNumbers, hostOf } from "./text-utils.js";

/** dispatch §5.5 authority whitelist. */
export const AUTHORITY_WHITELIST = [
  "clutch.co",
  "statista.com",
  "bls.gov",
  "gartner.com",
  "mckinsey.com",
  "hbr.org",
];
function isAuthority(url: string): boolean {
  const h = hostOf(url);
  return AUTHORITY_WHITELIST.some((d) => h === d || h.endsWith(`.${d}`)) || /\.gov$|\.edu$/.test(h);
}

/** A claim's numbers all appear (within ±5%) in the page text. */
function numbersMatch(claim: string, pageText: string): boolean {
  const claimNums = extractNumbers(claim);
  if (claimNums.length === 0) {
    // No number — fall back to a key-phrase substring (first ~8 words).
    const phrase = claim.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    return phrase.length > 0 && pageText.toLowerCase().includes(phrase);
  }
  const pageNums = extractNumbers(pageText);
  return claimNums.every((cn) =>
    pageNums.some((pn) => {
      if (cn === 0) return pn === 0;
      return Math.abs(pn - cn) / Math.abs(cn) <= 0.05;
    }),
  );
}

/* 6.3 — every statistic must resolve to a live (HTTP 200) source whose content
 * matches the claim. Failures are stripped and marked verified_live=false. — HARD */
export async function statsVerifiedLive(ctx: ValidatorContext): Promise<CheckResult> {
  const k = "all_stats_verified_live";
  const stats = ctx.article.statistics_used || [];
  const stripped: StrippedItem[] = [];

  await Promise.all(
    stats.map(async (s: StatisticUsed) => {
      const url = s.source_url || "";
      if (!url) {
        s.verified_live = false;
        stripped.push({ entityType: "statistic", detail: `no source_url: "${s.claim?.slice(0, 50)}"`, value: s });
        return;
      }
      try {
        const page = await ctx.deps.fetchUrl(url);
        if (!page.ok || page.status !== 200) {
          s.verified_live = false;
          stripped.push({ entityType: "statistic", detail: `source not live (HTTP ${page.status}): ${url}`, value: s });
          return;
        }
        if (!numbersMatch(s.claim || "", page.text)) {
          s.verified_live = false;
          stripped.push({ entityType: "statistic", detail: `claim not found on page (±5%): "${s.claim?.slice(0, 50)}"`, value: s });
          return;
        }
        s.verified_live = true;
      } catch {
        s.verified_live = false;
        stripped.push({ entityType: "statistic", detail: `fetch failed: ${url}`, value: s });
      }
    }),
  );

  return stripped.length === 0
    ? { key: k, passes: true, severity: "hard", reason: `${stats.length} statistic(s) verified live.` }
    : { key: k, passes: false, severity: "hard", reason: `${stripped.length} statistic(s) unverified and stripped.`, stripped };
}

/* 5.5 — authority floor: ≥2 external authority citations from the whitelist — HARD */
export function authorityFloor(ctx: ValidatorContext): CheckResult {
  const k = "authority_floor_passes";
  const cites = ctx.article.external_authority_citations || [];
  const authoritative = cites.filter((c) => isAuthority(c.url || c.domain || ""));
  return authoritative.length >= 2
    ? { key: k, passes: true, severity: "hard", reason: `${authoritative.length} authoritative citations.` }
    : { key: k, passes: false, severity: "hard", reason: `Only ${authoritative.length} whitelisted authority citation(s); need ≥2.` };
}

/* 5.5 / matrix #18 — stale-stat flagging: a stat older than currentYear-2 is
 * flagged inline (not a ship blocker). — SOFT */
export function staleStats(ctx: ValidatorContext): CheckResult {
  const k = "stats_freshness_passes";
  const stats = ctx.article.statistics_used || [];
  const cutoff = ctx.currentYear - 2;
  const stale: StrippedItem[] = [];
  for (const s of stats) {
    if (typeof s.year === "number" && s.year < cutoff) {
      s.flagged_as_stale = true;
      stale.push({ entityType: "statistic", detail: `stat from ${s.year} (< ${cutoff}): "${s.claim?.slice(0, 40)}"`, value: s.year });
    }
  }
  return stale.length === 0
    ? { key: k, passes: true, severity: "soft", reason: "All statistics within freshness window." }
    : { key: k, passes: false, severity: "soft", reason: `${stale.length} stat(s) flagged stale (older than ${cutoff}).`, stripped: stale };
}
