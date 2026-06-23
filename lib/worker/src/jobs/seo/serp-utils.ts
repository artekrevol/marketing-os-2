import type { SerpItem } from "@workspace/integrations-dataforseo";

/**
 * A single TRUE-organic SERP result. "Organic position" is recomputed
 * locally (ads, local pack, featured snippets, PAA, etc. excluded) so it
 * reflects where a domain actually ranks among organic blue links — not
 * DataForSEO's `rank_absolute`, which counts every SERP feature.
 */
export interface OrganicResult {
  /** 1-based position among organic results only. */
  organicPosition: number;
  /** DataForSEO's absolute rank (all SERP features) — kept for reference. */
  rankAbsolute: number | null;
  url: string | null;
  domain: string | null;
  title: string | null;
}

/** SERP item types that count as an organic blue-link result. */
const ORGANIC_TYPES: ReadonlySet<string> = new Set(["organic"]);

/**
 * Filter a raw SERP item list down to organic results and assign true
 * organic positions (1-based), ordered by DataForSEO `rank_absolute`.
 */
export function extractOrganicResults(items: SerpItem[]): OrganicResult[] {
  const organic = items
    .filter((it) => ORGANIC_TYPES.has(it.type))
    .sort(
      (a, b) =>
        (a.rank_absolute ?? Number.MAX_SAFE_INTEGER) -
        (b.rank_absolute ?? Number.MAX_SAFE_INTEGER),
    );

  return organic.map((it, idx) => ({
    organicPosition: idx + 1,
    rankAbsolute: it.rank_absolute ?? null,
    url: it.url ?? null,
    domain: it.domain ?? null,
    title: it.title ?? null,
  }));
}

/**
 * Normalize a domain or URL to a bare registrable host: lowercased, no
 * protocol, no `www.`, no path/query. Returns null for empty input.
 */
export function normalizeDomain(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.split("/")[0] ?? d;
  d = d.replace(/^www\./, "");
  return d || null;
}

/**
 * Find the brand's own result among organic results by domain match
 * (exact or subdomain). Returns null when the brand does not rank in the
 * captured depth.
 */
export function findDomainPosition(
  results: OrganicResult[],
  targetDomain: string,
): OrganicResult | null {
  const target = normalizeDomain(targetDomain);
  if (!target) return null;
  for (const r of results) {
    const d = normalizeDomain(r.domain ?? r.url);
    if (d && (d === target || d.endsWith(`.${target}`))) return r;
  }
  return null;
}
