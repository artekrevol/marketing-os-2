import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "./index";
import * as schema from "./schema";
import { ScopedDb, createGuardedDb } from "./middleware";

export type DbClient = NodePgDatabase<typeof schema>;

/**
 * Tables that MUST be scoped to a brand. The worker bypasses RLS (service
 * role), so we enforce tenancy in code via withBrandScope's middleware.
 *
 * Keep this list in sync with the Sprint 1 NOT-NULL brand_id tables.
 * Telemetry tables with nullable brand_id (events, integration_call_log)
 * are intentionally NOT in this list — they can be written cross-brand.
 */
export const BRAND_SCOPED_TABLES: ReadonlySet<string> = new Set([
  "projects",
  "drafts",
  "outlines",
  "research_findings",
  "voice_library",
  "fetched_pages",
  "ai_calls",
  "page_visits",
  "topic_briefs",
  "brand_personas",
  "competitor_pages",
  "keyword_lists",
  "rank_snapshots",
  // SEO Intelligence — keyword/rank/competitor module
  "locations",
  "keywords",
  "crawl_batches",
  "crawl_schedules",
  "competitor_insights",
  "blacklisted_domains",
  // LLM Citation Preservation — migrated legacy AI-citation data
  "llm_citation_runs",
  "llm_citation_snapshots",
  "llm_citation_items",
  "llm_citation_top_pages",
  "llm_competitors",
  "ai_overview_citations",
  // Sprint 3 — Quality Gate
  "content_objects",
  "qa_runs",
  "qa_check_results",
  "qa_signoffs",
  "qa_overrides",
  "qa_check_definitions",
  // Recovery War Room — parallel sprint
  "recovery_baselines",
  "recovery_initiatives",
  "recovery_snapshots",
  // Shared Data Layer — cross-module bridge tables
  "content_url_keyword_link",
  "keyword_research_briefs",
  "module_data_provenance",
  // ContentForge Quality Fix — asset corpora
  "reviews_bank_entries",
  "link_targets",
  "linking_rules",
  // Content Plan Architecture — planner templates, plans, named projects
  "content_plan_templates",
  "content_plans",
  "named_projects",
  // Ahrefs MCP Integration — cache and usage tracking
  "domain_authority_cache",
  "ahrefs_mcp_usage",
  // Ahrefs REST Bulk Import — referring domains corpus and REST usage log
  "referring_domains",
  "ahrefs_rest_usage",
  // DataForSEO Labs Discovery — competitor movements + Labs API cost tracking
  "competitor_movements",
  "dataforseo_labs_usage",
  // Ahrefs two-step snapshot upload (GCS-backed)
  "ahrefs_raw_snapshots",
]);

/** Brand context attached to a scoped transaction. */
export interface BrandScope {
  readonly brandId: string;
  /**
   * Guarded transaction client. Reads/writes against system tables
   * (events, dead_jobs, integration_call_log, brands, etc.) pass
   * through unchanged. Any `insert / update / delete / select.from`
   * targeting a `BRAND_SCOPED_TABLES` member throws
   * `BrandScopeViolationError` at runtime — forcing those operations
   * to go through `scoped.*`.
   */
  readonly db: DbClient;
  /**
   * Brand-aware helpers for brand-scoped tables. Every read/write
   * through `scoped` is automatically filtered by `brand_id` and
   * validated against the active scope; cross-brand attempts throw
   * at runtime.
   */
  readonly scoped: ScopedDb;
}

/**
 * Run `fn` inside a transaction with `app.current_brand` set to brandId
 * and `row_security = off` (the worker uses the service role, so RLS is
 * already bypassed; we set this explicitly so the postgres client can
 * never silently re-enable it via search_path tricks).
 *
 * Inside `fn`, callers MUST use the provided `scope.db` for any reads or
 * writes against brand-scoped tables. Callers should also use the
 * `assertBrandScope` helper before any write to validate that brand_id
 * matches the active scope.
 */
export async function withBrandScope<T>(
  brandId: string,
  fn: (scope: BrandScope) => Promise<T>,
  client: DbClient = defaultDb,
): Promise<T> {
  if (!brandId || typeof brandId !== "string") {
    throw new Error(`withBrandScope: brandId is required, got ${String(brandId)}`);
  }
  return client.transaction(async (tx) => {
    await tx.execute(sql`set local row_security = off`);
    await tx.execute(sql`select set_config('app.current_brand', ${brandId}, true)`);
    const txDb = tx as unknown as DbClient;
    return fn({
      brandId,
      db: createGuardedDb(txDb),
      scoped: new ScopedDb(brandId, txDb),
    });
  });
}

/**
 * Throws if the given record's brand_id does not match the active
 * scope. Use before every write to a brand-scoped table:
 *
 *   await withBrandScope(brandId, async ({ db, brandId }) => {
 *     assertBrandScope(brandId, row);
 *     await db.insert(projectsTable).values(row);
 *   });
 */
export function assertBrandScope(
  expectedBrandId: string,
  row: { brandId?: string | null; brand_id?: string | null },
): void {
  const actual = row.brandId ?? row.brand_id;
  if (!actual) {
    throw new Error(
      `assertBrandScope: row is missing brand_id (expected ${expectedBrandId})`,
    );
  }
  if (actual !== expectedBrandId) {
    throw new Error(
      `assertBrandScope: brand_id mismatch — row=${actual} scope=${expectedBrandId}`,
    );
  }
}

/**
 * Build a brand_id equality SQL fragment for raw filters. Always pair
 * with assertBrandScope on the row body for inserts.
 */
export function brandIdFilter(scope: BrandScope): SQL {
  return sql`brand_id = ${scope.brandId}`;
}
