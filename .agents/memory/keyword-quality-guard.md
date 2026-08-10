---
name: keyword-quality-guard
description: Rule for filtering keywords before dispatching to external APIs (DataForSEO, Ahrefs) — is_active AND list_id IS NOT NULL required in all worker keyword selects.
---

# Keyword quality guard — worker SELECT filter rule

## The rule
Every worker that reads from `keywords` and dispatches to an external API MUST filter:
```sql
WHERE is_active = true AND list_id IS NOT NULL
```
In Drizzle: `and(eq(keywordsTable.isActive, true), isNotNull(keywordsTable.listId))`.

**Why:** `is_active` alone is a flag anyone can set. `list_id IS NOT NULL` means a curator deliberately added the keyword to a tracked list — that is the editorial intent signal. Without both, a single orphaned/test keyword (e.g. a dev smoke-test row) passes through, hits a paid API, and writes garbage into competitor_pages or rank_snapshots.

**How to apply:** In the keyword SELECT inside `withBrandScope`, build a `qualityFilter` const and `and()` it with any payload-supplied `keywordIds` filter:
```ts
const qualityFilter = and(
  eq(keywordsTable.isActive, true),
  isNotNull(keywordsTable.listId),
);
const keywords = await scoped.select(keywordsTable, {
  where: payload.keywordIds?.length
    ? and(qualityFilter, inArray(keywordsTable.id, payload.keywordIds))
    : qualityFilter,
});
```

## Workers fixed (all four external-API keyword paths)
- `lib/worker/src/jobs/seo/competitor-discover.ts` — DataForSEO Live SERP
- `lib/worker/src/jobs/seo/crawl-run.ts` — DataForSEO Standard Queue
- `lib/worker/src/jobs/seo/rank-check-scheduled.ts` — upstream gate for crawl-run
- `lib/worker/src/jobs/seo/discovery-weekly.ts` — seed SQL already had `is_active`; `AND list_id IS NOT NULL` added

## Dedup query exemption
`discovery-weekly.ts` lines ~337-342 (existing-keyword dedup) does NOT filter by `is_active` or `list_id` — intentional. It only excludes already-tracked text before inserting candidates; it doesn't drive any API call.

## Incident that established this rule
Dev smoke-test keyword `"marketing os smoke"` was manually inserted into TekRevol's `keywords` table with no `list_id`. Competitor-discover ran it through DataForSEO Live SERP; Google returned tobacco-industry-marketing pages; those 10 URLs were written to `competitor_pages` under TekRevol, appearing as competitors on the Competitors page. Not a brand-scope violation — all rows correctly scoped to TekRevol. Root cause: no quality filter before dispatching.

## Orphan keywords (list_id IS NULL) are NOT automatically garbage
TekRevol has 422 legitimate orphan keywords (Dec 2025 geo batch + Jul 2026 broad batch) that were seeded before list structure existed or imported without list assignment. Do not bulk-delete orphans — assign them to lists instead. The quality guard prevents them from reaching paid APIs without deletion.
