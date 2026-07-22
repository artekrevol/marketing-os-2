import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { withBrandScope } from "../brand-scope";
import {
  reviewsBankEntriesTable,
  linkTargetsTable,
  linkingRulesTable,
  namedProjectsTable,
  type ReviewsBankEntry,
  type LinkTarget,
  type LinkingRule,
  type NamedProject,
} from "../schema";
import type { DataSource, QueryResult } from "./types";

/**
 * Asset-corpus query helpers (ContentForge Quality Fix v2, dispatch §2.3).
 *
 * These read the three brand-scoped asset tables (reviews_bank_entries,
 * link_targets, linking_rules) and back the generation-time + validator
 * lookups in later phases. They mirror the cross-module helper contract:
 *
 *  - Every read goes through `withBrandScope`, so cross-brand rows are
 *    structurally invisible (tenant isolation is not conditional).
 *  - List helpers return the shared `QueryResult<T>` shape and NEVER throw —
 *    DB/system failures surface as `reason: 'system-error'`, empty corpora as
 *    `reason: 'not-tracked'`.
 *  - Predicate / list-of-string helpers return plain values (per the dispatch
 *    signatures) and fail CLOSED: on error they report "absent" (false / []),
 *    because they gate anti-fabrication checks where a false negative (re-flag a
 *    real review) is safer than a false positive (pass a fabricated one).
 *
 * The "safe" rows are always filtered here: testimonials exclude
 * `is_confidential = true`; link targets require `is_active = true`. These
 * filters match the partial indexes on the tables.
 *
 * NOTE: the playbook-derived helpers from §2.3 (getActivePlaybook /
 * getBannedPhrases / getDiscardList / getCredentialBlock) deliberately live in
 * `@workspace/content-ai` (lib/content-ai/src/playbook.ts), NOT here: parsing
 * the playbook markdown is content-ai's job, and `lib/db` importing content-ai
 * would create a dependency cycle (content-ai already imports `@workspace/db`).
 */

/** Assets have no crawl-based staleness; the source tag marks them fresh
 *  and manually refreshable (re-import). */
function assetSource(generatedAt: Date | null): DataSource | null {
  if (!generatedAt) return null;
  return {
    module: "content-forge",
    generatedAt,
    isFresh: true,
    staleAfterDays: 0,
    refreshAction: "manual",
  };
}

function latest(dates: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d);
    if (!max || t.getTime() > max.getTime()) max = t;
  }
  return max;
}

/* -------------------------------------------------------------------------- */
/* Reviews bank — always exclude is_confidential = true                       */
/* -------------------------------------------------------------------------- */

export async function findTestimonials(opts: {
  brandId: string;
  icp?: number;
  vertical?: string;
  costBucket?: string;
  /**
   * Filter by industry tags (any-overlap). Rows whose `industry_tags` JSON
   * array contains AT LEAST ONE of the provided strings are included.
   * Uses GIN index via @> containment OR chain. Empty array = no filter.
   */
  industryTags?: string[];
  /**
   * Filter by keyword tags (any-overlap). Same semantics as industryTags.
   */
  keywordTags?: string[];
  limit?: number;
}): Promise<QueryResult<ReviewsBankEntry[]>> {
  const { brandId, icp, vertical, costBucket, industryTags, keywordTags, limit = 50 } = opts;
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const conds = [eq(reviewsBankEntriesTable.isConfidential, false)];
      if (icp != null) conds.push(eq(reviewsBankEntriesTable.icp, icp));
      if (vertical) conds.push(eq(reviewsBankEntriesTable.vertical, vertical));
      if (costBucket)
        conds.push(eq(reviewsBankEntriesTable.costBucket, costBucket));
      // Tag filters: any-overlap via @> containment OR chain. GIN-indexed.
      if (industryTags && industryTags.length > 0) {
        conds.push(
          or(
            ...industryTags.map((tag) =>
              sql`${reviewsBankEntriesTable.industryTags} @> ${JSON.stringify([tag])}::jsonb`,
            ),
          )!,
        );
      }
      if (keywordTags && keywordTags.length > 0) {
        conds.push(
          or(
            ...keywordTags.map((tag) =>
              sql`${reviewsBankEntriesTable.keywordTags} @> ${JSON.stringify([tag])}::jsonb`,
            ),
          )!,
        );
      }

      const rows = (await scoped.select(reviewsBankEntriesTable, {
        where: and(...conds)!,
        // `id` tiebreak makes the LIMITed subset deterministic when several rows
        // share a lastVerifiedAt — generation callers inject these into cached
        // prompts and rely on a byte-identical candidate block across calls.
        orderBy: [desc(reviewsBankEntriesTable.lastVerifiedAt), asc(reviewsBankEntriesTable.id)],
        limit,
      })) as ReviewsBankEntry[];

      if (rows.length === 0) {
        return { data: [], source: null, reason: "not-tracked" as const };
      }
      const generatedAt = latest(rows.map((r) => r.lastVerifiedAt));
      return { data: rows, source: assetSource(generatedAt), reason: null };
    });
  } catch {
    return { data: [], source: null, reason: "system-error" };
  }
}

/**
 * True iff a testimonial with this reviewer + company exists in the bank AND
 * the stored excerpt overlaps the supplied quote (substring either way). Used
 * by the anti-fabrication validator. Confidential rows still count as "in
 * bank" here — the point is provenance, not publishability. Fails closed.
 */
export async function isReviewInBank(
  brandId: string,
  reviewerName: string,
  company: string,
  quoteExcerpt: string,
): Promise<boolean> {
  const needle = quoteExcerpt.trim().toLowerCase();
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(reviewsBankEntriesTable, {
        where: and(
          ilike(reviewsBankEntriesTable.reviewerName, reviewerName.trim()),
          ilike(reviewsBankEntriesTable.company, company.trim()),
        )!,
      })) as ReviewsBankEntry[];
      if (rows.length === 0) return false;
      if (!needle) return true; // name+company match is enough when no quote given
      return rows.some((r) => {
        const hay = (r.quoteExcerpt || "").toLowerCase();
        const full = (r.quoteFull || "").toLowerCase();
        return (
          hay.includes(needle) ||
          needle.includes(hay) ||
          (!!full && (full.includes(needle) || needle.includes(full)))
        );
      });
    });
  } catch {
    return false;
  }
}

/** Distinct company names flagged confidential — the generation exclusion list. */
export async function getConfidentialCompanies(
  brandId: string,
): Promise<string[]> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(reviewsBankEntriesTable, {
        where: eq(reviewsBankEntriesTable.isConfidential, true),
      })) as ReviewsBankEntry[];
      const set = new Set<string>();
      for (const r of rows) if (r.company) set.add(r.company);
      return Array.from(set).sort();
    });
  } catch {
    return [];
  }
}

/**
 * Distinct project names for the anti-fabrication validator.
 *
 * Merges two sources:
 *  1. `project_name` values from `reviews_bank_entries` (legacy corpus)
 *  2. `name` values from `named_projects` (new first-class corpus, Phase 1.4)
 *
 * The validator checks that a case study's `project_name` exists in EITHER
 * the playbook portfolio OR this combined list. Fails closed ([] on error).
 */
export async function getReviewsBankProjectNames(
  brandId: string,
): Promise<string[]> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const [reviewRows, namedRows] = await Promise.all([
        scoped.select(reviewsBankEntriesTable, {
          where: sql`${reviewsBankEntriesTable.projectName} is not null`,
        }) as Promise<ReviewsBankEntry[]>,
        scoped.select(namedProjectsTable, {
          where: eq(namedProjectsTable.isActive, true),
        }) as Promise<NamedProject[]>,
      ]);
      const set = new Set<string>();
      for (const r of reviewRows) {
        const n = (r.projectName || "").trim();
        if (n) set.add(n);
      }
      for (const p of namedRows) {
        const n = (p.name || "").trim();
        if (n) set.add(n);
      }
      return Array.from(set).sort();
    });
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Link targets — always require is_active = true                             */
/* -------------------------------------------------------------------------- */

export async function findLinkTargets(opts: {
  brandId: string;
  cluster?: string;
  vertical?: string;
  funnelStage?: "TOFU" | "MOFU" | "BOFU";
  icp?: number;
  limit?: number;
}): Promise<QueryResult<LinkTarget[]>> {
  const { brandId, cluster, vertical, funnelStage, icp, limit = 50 } = opts;
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const conds = [eq(linkTargetsTable.isActive, true)];
      if (cluster) conds.push(eq(linkTargetsTable.contentCluster, cluster));
      if (vertical) conds.push(eq(linkTargetsTable.vertical, vertical));
      if (funnelStage) conds.push(eq(linkTargetsTable.funnelStage, funnelStage));
      if (icp != null) conds.push(eq(linkTargetsTable.primaryIcp, icp));

      const rows = (await scoped.select(linkTargetsTable, {
        where: and(...conds)!,
        // `id` tiebreak makes the LIMITed subset deterministic when several rows
        // share a lastVerifiedAt — generation callers inject these into cached
        // prompts and rely on a byte-identical candidate block across calls.
        orderBy: [desc(linkTargetsTable.lastVerifiedAt), asc(linkTargetsTable.id)],
        limit,
      })) as LinkTarget[];

      if (rows.length === 0) {
        return { data: [], source: null, reason: "not-tracked" as const };
      }
      const generatedAt = latest(rows.map((r) => r.lastVerifiedAt));
      return { data: rows, source: assetSource(generatedAt), reason: null };
    });
  } catch {
    return { data: [], source: null, reason: "system-error" };
  }
}

/** True iff an active link target with this exact URL exists. Fails closed. */
export async function isUrlInLinkTargets(
  brandId: string,
  url: string,
): Promise<boolean> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(linkTargetsTable, {
        where: and(
          eq(linkTargetsTable.url, url.trim()),
          eq(linkTargetsTable.isActive, true),
        )!,
        limit: 1,
      })) as LinkTarget[];
      return rows.length > 0;
    });
  } catch {
    return false;
  }
}

/** Anchor-text variations for an active link target URL ([] if none/error). */
export async function getAnchorVariations(
  brandId: string,
  url: string,
): Promise<string[]> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(linkTargetsTable, {
        where: and(
          eq(linkTargetsTable.url, url.trim()),
          eq(linkTargetsTable.isActive, true),
        )!,
        limit: 1,
      })) as LinkTarget[];
      const raw = rows[0]?.anchorVariations;
      if (!Array.isArray(raw)) return [];
      return raw.filter((x): x is string => typeof x === "string");
    });
  } catch {
    return [];
  }
}

/**
 * Linking rules whose trigger matches a content cluster. Matches the cluster
 * against `trigger_pattern` (case-insensitive, substring either direction) so
 * a rule keyed to "fintech-app-development" fires for a "fintech app" cluster.
 */
export async function getLinkingRulesForCluster(
  brandId: string,
  cluster: string,
): Promise<QueryResult<LinkingRule[]>> {
  const needle = cluster.trim();
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const rows = (await scoped.select(linkingRulesTable, {
        where: sql`(${linkingRulesTable.triggerPattern} ILIKE ${"%" + needle + "%"} OR ${needle} ILIKE '%' || ${linkingRulesTable.triggerPattern} || '%')`,
        orderBy: desc(linkingRulesTable.createdAt),
      })) as LinkingRule[];

      if (rows.length === 0) {
        return { data: [], source: null, reason: "not-tracked" as const };
      }
      const generatedAt = latest(rows.map((r) => r.createdAt));
      return { data: rows, source: assetSource(generatedAt), reason: null };
    });
  } catch {
    return { data: [], source: null, reason: "system-error" };
  }
}

/* -------------------------------------------------------------------------- */
/* Named projects — first-class project case evidence corpus (Phase 1.4)      */
/* -------------------------------------------------------------------------- */

/**
 * Retrieve active named projects for a brand, optionally filtered by industry
 * or keyword tags. Backed by GIN indexes on both tag columns.
 *
 * Used by the planner AI to select the most relevant project reference(s) for
 * a given article, and by the Rules Dashboard to display the named projects
 * corpus for Rabia to tag and manage.
 *
 * Tag filters use any-overlap semantics (OR): a project is included if its
 * industry_tags or keyword_tags contain AT LEAST ONE of the provided values.
 * Fails closed (empty array on error).
 */
export async function findNamedProjects(opts: {
  brandId: string;
  /**
   * Any-overlap industry filter. e.g. ['healthcare', 'fintech']
   * Returns projects tagged with ANY of these industries.
   */
  industryTags?: string[];
  /**
   * Any-overlap keyword filter. e.g. ['hipaa_compliance', 'mobile_apps']
   * Returns projects tagged with ANY of these keyword tags.
   */
  keywordTags?: string[];
  /** Include confidential rows (default false — only non-confidential). */
  includeConfidential?: boolean;
  limit?: number;
}): Promise<QueryResult<NamedProject[]>> {
  const {
    brandId,
    industryTags,
    keywordTags,
    includeConfidential = false,
    limit = 50,
  } = opts;
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const conds = [eq(namedProjectsTable.isActive, true)];
      if (!includeConfidential) {
        conds.push(eq(namedProjectsTable.isConfidential, false));
      }
      if (industryTags && industryTags.length > 0) {
        conds.push(
          or(
            ...industryTags.map((tag) =>
              sql`${namedProjectsTable.industryTags} @> ${JSON.stringify([tag])}::jsonb`,
            ),
          )!,
        );
      }
      if (keywordTags && keywordTags.length > 0) {
        conds.push(
          or(
            ...keywordTags.map((tag) =>
              sql`${namedProjectsTable.keywordTags} @> ${JSON.stringify([tag])}::jsonb`,
            ),
          )!,
        );
      }

      const rows = (await scoped.select(namedProjectsTable, {
        where: and(...conds)!,
        orderBy: [asc(namedProjectsTable.name)],
        limit,
      })) as NamedProject[];

      if (rows.length === 0) {
        return { data: [], source: null, reason: "not-tracked" as const };
      }
      const generatedAt = latest(rows.map((r) => r.updatedAt));
      return { data: rows, source: assetSource(generatedAt), reason: null };
    });
  } catch {
    return { data: [], source: null, reason: "system-error" };
  }
}
