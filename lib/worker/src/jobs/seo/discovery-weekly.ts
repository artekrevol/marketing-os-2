import { sql } from "drizzle-orm";
import {
  withBrandScope,
  keywordsTable,
  locationsTable,
  competitorInsightsTable,
  competitorMovementsTable,
  eventsTable,
  type Location,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import {
  DataForSEOClient,
  type RelatedKeywordItem,
  type RankedKeywordItem,
} from "@workspace/integrations-dataforseo";
import type { Logger } from "pino";
import { assertNotDuplicate } from "../idempotency";

const SUCCESS_EVENT = "seo.discovery.weekly.completed";

/**
 * Returns the ISO week label (YYYY-WW) for a given Date (UTC).
 * Week 1 is the week containing the first Thursday of the year (ISO 8601).
 *
 * Exported for smoke-test coverage.
 */
export function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO week: Thursday is the anchor day (day 4). Adjust so Thursday = day 0.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

/**
 * True when the keyword difficulty `kd` should survive the KD filter.
 * Identical predicate used in Step B (related keywords) and Step D
 * (competitor mining): unknown KD passes through; drop KD >= threshold.
 *
 * Exported for smoke-test coverage.
 */
export function kdPassesThroughFilter(
  kd: number | null | undefined,
  threshold: number,
): boolean {
  return kd == null || kd < threshold;
}

/**
 * Compute drop-rate percentage from before/after candidate counts.
 * Returns 0 when `before` is 0 to avoid divide-by-zero.
 * Result is rounded to 2 decimal places (e.g. 33.33).
 *
 * Exported for smoke-test coverage.
 */
export function computeDropRatePct(before: number, after: number): number {
  if (before === 0) return 0;
  const dropped = before - after;
  return Math.round((dropped / before) * 10_000) / 100;
}

/**
 * Resolve the effective KD threshold from the environment variable
 * DISCOVERY_KD_FILTER_MAX (operator-level override) and the payload default.
 * - env var present and is a valid integer string → clamp to [0, 100]
 * - env var absent or invalid → payload.maxKd as-is
 *
 * Exported for smoke-test coverage.
 */
export function resolveKdThreshold(
  envVar: string | undefined,
  payloadMaxKd: number,
): number {
  if (envVar != null && /^\d+$/.test(envVar)) {
    return Math.min(100, Math.max(0, parseInt(envVar, 10)));
  }
  return payloadMaxKd;
}

/** Chunk an array into slices of `size`. */
function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Curated competitor set for TekRevol (Phase 0 approval). Excludes clutch.co and koderspedia.com. */
const CURATED_COMPETITORS = [
  "appinventiv.com",
  "trangotech.com",
  "buildfire.com",
  "appwrk.com",
];

export interface KdFilterStats {
  /** Total candidates entering the KD filter (Step B + Step D combined). */
  candidatesBeforeKdFilter: number;
  /** Total candidates surviving the KD filter (Step B + Step D combined). */
  candidatesAfterKdFilter: number;
  /** Dropped in Step B (related-keywords expansion). */
  droppedRelatedKeywordsStep: number;
  /** Dropped in Step D (competitor keyword mining). */
  droppedCompetitorMiningStep: number;
  /** Effective threshold used (exclusive upper bound: drop KD ≥ threshold). */
  threshold: number;
  /** (before − after) / before, expressed as a percentage (0–100, 2 dp). */
  dropRatePct: number;
}

export interface DiscoveryWeeklyResult {
  weekLabel: string;
  seedsExpanded: number;
  rawCandidates: number;
  afterDedup: number;
  afterKdFilter: number;
  afterExistingFilter: number;
  insertedCandidates: number;
  competitorCandidatesInserted: number;
  competitorMovementsWritten: number;
  archivedStale: number;
  kdFilterStats: KdFilterStats;
  duplicate?: true;
}

/**
 * Weekly Discovery Engine — Phase 3.
 *
 * Step A  Seed keyword expansion via relatedKeywords()
 * Step B  Dedup + bulk KD filter via bulkKeywordDifficulty()
 * Step C  Existing keyword exclusion + DB insert as pending candidates
 * Step D  Competitor keyword mining via rankedKeywords() + insert
 * Step E  competitor_movements snapshot write
 * Step F  30-day auto-archive sweep for stale pending candidates
 * Step G  Success event
 */
export async function handleSeoDiscoveryWeekly(
  payload: JobData<"seo.discovery.weekly">,
  log: Logger,
): Promise<DiscoveryWeeklyResult> {
  const dup = await assertNotDuplicate(SUCCESS_EVENT, payload.idempotencyKey, log);
  if (dup.duplicate) {
    return {
      weekLabel: payload.weekLabel ?? isoWeekLabel(new Date()),
      seedsExpanded: 0,
      rawCandidates: 0,
      afterDedup: 0,
      afterKdFilter: 0,
      afterExistingFilter: 0,
      insertedCandidates: 0,
      competitorCandidatesInserted: 0,
      competitorMovementsWritten: 0,
      archivedStale: 0,
      kdFilterStats: {
        candidatesBeforeKdFilter: 0,
        candidatesAfterKdFilter: 0,
        droppedRelatedKeywordsStep: 0,
        droppedCompetitorMiningStep: 0,
        threshold: payload.maxKd,
        dropRatePct: 0,
      },
      duplicate: true,
    };
  }

  const weekLabel = payload.weekLabel ?? isoWeekLabel(new Date());
  const dispatchCtx = `discovery_week_${weekLabel}`;

  // Resolve effective KD threshold. DISCOVERY_KD_FILTER_MAX env var takes
  // precedence at runtime (operator-level tuning without code changes).
  // Explicit payload.maxKd is used as fallback when the env var is absent.
  const envKdRaw = process.env["DISCOVERY_KD_FILTER_MAX"];
  const effectiveMaxKd: number =
    envKdRaw != null && /^\d+$/.test(envKdRaw)
      ? Math.min(100, Math.max(0, parseInt(envKdRaw, 10)))
      : payload.maxKd;

  const seedLimit = payload.seedLimit;
  const relatedLimit = payload.relatedLimit;
  const competitorRankedLimit = payload.competitorRankedLimit;

  log.info(
    { weekLabel, dispatchCtx, effectiveMaxKd, envKdRaw, seedLimit },
    "seo.discovery.weekly: starting",
  );

  return withBrandScope(payload.brandId, async ({ db, scoped }) => {
    const client = new DataForSEOClient({ brandId: payload.brandId });

    // ------------------------------------------------------------------
    // Locate the brand's US location (dataforseo_location_code = 2840).
    // Fall back to first location if no US location is registered.
    // ------------------------------------------------------------------
    const locations = (await scoped.select(locationsTable)) as Location[];
    const usLocation =
      locations.find((l) => l.dataforseoLocationCode === 2840) ?? locations[0];
    if (!usLocation) {
      throw new Error(
        `seo.discovery.weekly: brand ${payload.brandId} has no locations — cannot determine location_id`,
      );
    }
    const locationCode = usLocation.dataforseoLocationCode;
    const locationId = usLocation.id;
    const languageCode = usLocation.languageCode ?? "en";

    // ------------------------------------------------------------------
    // Step A — Seed keyword expansion
    // Pull top `seedLimit` non-branded commercial/transactional P0/P1
    // keywords sorted by ahrefs_sum_traffic DESC (dispatcher-approved query).
    // ------------------------------------------------------------------
    const seedRows = (await db.execute(sql`
      SELECT keyword_text, id
      FROM keywords
      WHERE brand_id = ${payload.brandId}::uuid
        AND priority IN ('P0', 'P1')
        AND is_active = true
        AND is_branded = false
        AND (
          ahrefs_intent_flags->>'commercial'     = 'true'
          OR ahrefs_intent_flags->>'transactional' = 'true'
        )
      ORDER BY ahrefs_sum_traffic DESC NULLS LAST
      LIMIT ${seedLimit}
    `)) as unknown as { rows?: Array<{ keyword_text: string; id: string }> } | Array<{ keyword_text: string; id: string }>;

    const seeds: string[] = (Array.isArray(seedRows) ? seedRows : (seedRows.rows ?? []))
      .map((r) => r.keyword_text)
      .filter(Boolean);

    log.info({ seeds: seeds.length }, "seo.discovery.weekly: step A — seeds loaded");

    // Collect: { text, searchVolume, seedKeyword }
    interface RawCandidate {
      text: string;
      searchVolume: number | null;
      seedKeyword: string;
    }

    const rawMap = new Map<string, RawCandidate>(); // keyed by lowercased text

    for (const seed of seeds) {
      try {
        const res = await client.relatedKeywords({
          keyword: seed,
          locationCode,
          languageCode,
          limit: relatedLimit,
          depth: 1,
          dispatchContext: dispatchCtx,
        });
        const items: RelatedKeywordItem[] = res.tasks[0]?.result?.[0]?.items ?? [];
        for (const item of items) {
          const text = item.keyword_data?.keyword?.trim();
          if (!text) continue;
          const key = text.toLowerCase();
          if (!rawMap.has(key)) {
            rawMap.set(key, {
              text,
              searchVolume: item.keyword_data?.keyword_info?.search_volume ?? null,
              seedKeyword: seed,
            });
          }
        }
      } catch (err) {
        // Per-seed failure: log and continue — one bad seed should not abort the run
        log.warn(
          { seed, err: (err as Error).message },
          "seo.discovery.weekly: relatedKeywords failed for seed — skipping",
        );
      }
    }

    const rawCandidates = rawMap.size;
    log.info(
      { rawCandidates, seedsExpanded: seeds.length },
      "seo.discovery.weekly: step A complete",
    );

    // ------------------------------------------------------------------
    // Step B — Bulk KD filter (batches of 1000)
    // ------------------------------------------------------------------
    const allTexts = Array.from(rawMap.keys());
    const kdMap = new Map<string, number>(); // lowercased text → KD score

    for (const batch of chunks(allTexts, 1000)) {
      try {
        const res = await client.bulkKeywordDifficulty({
          keywords: batch.map((k) => rawMap.get(k)!.text), // use original casing
          locationCode,
          languageCode,
          dispatchContext: dispatchCtx,
        });
        const items = res.tasks[0]?.result?.[0]?.items ?? [];
        for (const item of items) {
          if (item.keyword && item.keyword_difficulty != null) {
            kdMap.set(item.keyword.toLowerCase(), item.keyword_difficulty);
          }
        }
      } catch (err) {
        log.warn(
          { batchSize: batch.length, err: (err as Error).message },
          "seo.discovery.weekly: bulkKeywordDifficulty batch failed — continuing without KD filter for this batch",
        );
      }
    }

    // Filter: keep KD < effectiveMaxKd (unknown KD passes through — reviewer decides).
    // Drop KD >= effectiveMaxKd: high-difficulty keywords unlikely to be winnable
    // and waste reviewer attention. Threshold is operator-configurable via
    // DISCOVERY_KD_FILTER_MAX env var; defaults to 70.
    const afterKdFilter: RawCandidate[] = [];
    for (const [key, candidate] of rawMap) {
      const kd = kdMap.get(key);
      if (kd == null || kd < effectiveMaxKd) {
        afterKdFilter.push(candidate);
      }
    }
    const droppedRelated = rawCandidates - afterKdFilter.length;

    log.info(
      {
        afterDedup: rawCandidates,
        afterKdFilter: afterKdFilter.length,
        droppedRelated,
        threshold: effectiveMaxKd,
      },
      "seo.discovery.weekly: step B complete",
    );

    // ------------------------------------------------------------------
    // Step C — Exclude already-tracked keywords, insert remaining as
    //          pending discovery candidates
    // ------------------------------------------------------------------

    // Pull existing keyword_text values for this brand+location to dedupe
    const existingRows = (await db.execute(sql`
      SELECT lower(keyword_text) AS ktext
      FROM keywords
      WHERE brand_id = ${payload.brandId}::uuid
        AND location_id = ${locationId}::uuid
    `)) as unknown as { rows?: Array<{ ktext: string }> } | Array<{ ktext: string }>;

    const existingSet = new Set<string>(
      (Array.isArray(existingRows) ? existingRows : (existingRows.rows ?? []))
        .map((r) => r.ktext),
    );

    const newCandidates = afterKdFilter.filter(
      (c) => !existingSet.has(c.text.toLowerCase()),
    );

    log.info(
      {
        afterKdFilter: afterKdFilter.length,
        afterExistingFilter: newCandidates.length,
      },
      "seo.discovery.weekly: step C — existing keyword exclusion done",
    );

    const now = new Date();
    let insertedCandidates = 0;

    for (const batch of chunks(newCandidates, 500)) {
      const rows = batch.map((c) => ({
        brandId: payload.brandId,
        keywordText: c.text,
        locationId,
        searchVolume: c.searchVolume,
        isDiscoveryCandidate: true,
        discoveredAt: now,
        discoverySeedKeyword: c.seedKeyword,
        candidateReviewStatus: "pending" as const,
        // Difficulty from the KD map (may be undefined → null)
        difficulty: kdMap.has(c.text.toLowerCase())
          ? kdMap.get(c.text.toLowerCase())!.toString()
          : null,
      }));

      await db
        .insert(keywordsTable)
        .values(rows)
        .onConflictDoNothing();

      insertedCandidates += rows.length;
    }

    log.info(
      { insertedCandidates },
      "seo.discovery.weekly: step C complete — candidates inserted",
    );

    // ------------------------------------------------------------------
    // Step D — Competitor keyword mining
    //
    // D.0  Resolve relevant competitor domains from competitor_insights
    //      (is_relevant_competitor IS NULL = not yet reviewed = include;
    //       is_relevant_competitor = false = explicitly excluded).
    //      Falls back to CURATED_COMPETITORS when the DB is empty
    //      (e.g. first run or unconfigured brand).
    //
    // D.1  Fetch ranked keywords per domain. Deduplicate across domains:
    //      a keyword seen for multiple competitors keeps the first domain's
    //      attribution (highest shared_keyword_count order from D.0).
    //
    // D.2  Bulk KD score competitor keywords not already in kdMap (Step B
    //      only scored related keywords). This makes Step D's KD filter
    //      as accurate as Step B's — same predicate, same threshold.
    //
    // D.3  Apply kdPassesThroughFilter; count drops.
    // D.4  Insert candidates in batches of 500.
    // ------------------------------------------------------------------

    // D.0 — Resolve competitor domains from DB
    const relCompRows = (await db.execute(sql`
      SELECT competitor_domain
      FROM competitor_insights
      WHERE brand_id = ${payload.brandId}::uuid
        AND (is_relevant_competitor IS NULL OR is_relevant_competitor = true)
      ORDER BY shared_keyword_count DESC NULLS LAST
    `)) as unknown as
      | { rows?: Array<{ competitor_domain: string }> }
      | Array<{ competitor_domain: string }>;

    const dbCompetitors: string[] = (
      Array.isArray(relCompRows) ? relCompRows : (relCompRows.rows ?? [])
    ).map((r) => r.competitor_domain).filter(Boolean);

    // Fall back to compile-time curated list when the DB table is empty.
    const competitorDomains = dbCompetitors.length > 0
      ? dbCompetitors
      : CURATED_COMPETITORS;

    log.info(
      { count: competitorDomains.length, source: dbCompetitors.length > 0 ? "db" : "fallback" },
      "seo.discovery.weekly: step D.0 — competitor set resolved",
    );

    // D.1 — Fetch ranked keywords; deduplicate across domains
    // Map: lowercased text → { original-cased text, first-attribution domain }
    const compMap = new Map<string, { text: string; domain: string }>();

    for (const domain of competitorDomains) {
      try {
        const res = await client.rankedKeywords({
          target: domain,
          locationCode,
          languageCode,
          limit: competitorRankedLimit,
        });
        const items: RankedKeywordItem[] = res.tasks[0]?.result?.[0]?.items ?? [];

        let added = 0;
        for (const item of items) {
          const text = item.keyword_data?.keyword?.trim();
          if (!text) continue;
          const lower = text.toLowerCase();
          // Skip: already tracked, already seen from another competitor
          if (existingSet.has(lower) || compMap.has(lower)) continue;
          compMap.set(lower, { text, domain });
          added++;
        }

        log.info(
          { domain, ranked: items.length, addedUnique: added },
          "seo.discovery.weekly: step D.1 — ranked keywords fetched",
        );
      } catch (err) {
        log.warn(
          { domain, err: (err as Error).message },
          "seo.discovery.weekly: rankedKeywords failed for competitor — skipping",
        );
      }
    }

    // D.2 — Bulk KD score competitor keywords not already in kdMap.
    // Step B populated kdMap only for related keywords; competitor keywords
    // need a separate scoring pass so the filter has real KD values.
    const unscoredCompTexts = Array.from(compMap.entries())
      .filter(([lower]) => !kdMap.has(lower))
      .map(([, { text }]) => text);

    for (const batch of chunks(unscoredCompTexts, 1000)) {
      try {
        const res = await client.bulkKeywordDifficulty({
          keywords: batch,
          locationCode,
          languageCode,
          dispatchContext: `${dispatchCtx}_competitor_kd`,
        });
        const items = res.tasks[0]?.result?.[0]?.items ?? [];
        for (const item of items) {
          if (item.keyword && item.keyword_difficulty != null) {
            kdMap.set(item.keyword.toLowerCase(), item.keyword_difficulty);
          }
        }
      } catch (err) {
        log.warn(
          { batchSize: batch.length, err: (err as Error).message },
          "seo.discovery.weekly: bulkKeywordDifficulty (competitor) failed — continuing without KD for batch",
        );
      }
    }

    log.info(
      { unscored: unscoredCompTexts.length, kdMapSize: kdMap.size },
      "seo.discovery.weekly: step D.2 — competitor KD scoring complete",
    );

    // D.3 — Apply KD filter using the same predicate as Step B
    const compBeforeKdFilter = compMap.size;
    let droppedCompetitor = 0;

    const compCandidates: Array<{ text: string; domain: string; difficulty: string | null }> = [];
    for (const [lower, { text, domain }] of compMap) {
      const kd = kdMap.get(lower);
      if (!kdPassesThroughFilter(kd, effectiveMaxKd)) {
        droppedCompetitor++;
        continue;
      }
      compCandidates.push({
        text,
        domain,
        difficulty: kd != null ? kd.toString() : null,
      });
    }

    log.info(
      {
        beforeKdFilter: compBeforeKdFilter,
        afterKdFilter: compCandidates.length,
        droppedKd: droppedCompetitor,
        threshold: effectiveMaxKd,
      },
      "seo.discovery.weekly: step D.3 — KD filter applied to competitor keywords",
    );

    // D.4 — Insert candidates
    let competitorCandidatesInserted = 0;
    for (const batch of chunks(compCandidates, 500)) {
      const rows = batch.map(({ text, domain, difficulty }) => ({
        brandId: payload.brandId,
        keywordText: text,
        locationId,
        isDiscoveryCandidate: true,
        discoveredAt: now,
        discoverySeedKeyword: `competitor:${domain}`,
        candidateReviewStatus: "pending" as const,
        difficulty,
      }));
      await db.insert(keywordsTable).values(rows).onConflictDoNothing();
      competitorCandidatesInserted += rows.length;
    }

    log.info(
      { competitorCandidatesInserted },
      "seo.discovery.weekly: step D complete — competitor candidates inserted",
    );

    // ------------------------------------------------------------------
    // Step E — competitor_movements snapshot
    // For each relevant competitor, write one row for this week.
    // Uses competitorDomains (DB-resolved) — not the hard-coded fallback —
    // so curation changes take effect on the next run.
    // ------------------------------------------------------------------
    let competitorMovementsWritten = 0;

    // Fetch current competitor_insights rows for the active set
    const insightRows = competitorDomains.length > 0
      ? (await db.execute(sql`
          SELECT competitor_domain, shared_keyword_count
          FROM competitor_insights
          WHERE brand_id = ${payload.brandId}::uuid
            AND competitor_domain = ANY(ARRAY[${sql.join(
              competitorDomains.map((d) => sql`${d}`),
              sql`, `,
            )}])
        `)) as unknown as
          | { rows?: Array<{ competitor_domain: string; shared_keyword_count: number }> }
          | Array<{ competitor_domain: string; shared_keyword_count: number }>
      : [];

    const insightMap = new Map<string, number>(
      (Array.isArray(insightRows) ? insightRows : (insightRows.rows ?? []))
        .map((r) => [r.competitor_domain, r.shared_keyword_count]),
    );

    // Fetch last week's movements to compute delta + is_new
    const prevWeekRows = competitorDomains.length > 0
      ? (await db.execute(sql`
          SELECT competitor_domain, keywords_common
          FROM competitor_movements
          WHERE brand_id = ${payload.brandId}::uuid
            AND competitor_domain = ANY(ARRAY[${sql.join(
              competitorDomains.map((d) => sql`${d}`),
              sql`, `,
            )}])
          ORDER BY captured_at DESC
        `)) as unknown as
          | { rows?: Array<{ competitor_domain: string; keywords_common: number }> }
          | Array<{ competitor_domain: string; keywords_common: number }>
      : [];

    const prevMap = new Map<string, number>();
    for (const row of (Array.isArray(prevWeekRows) ? prevWeekRows : (prevWeekRows.rows ?? []))) {
      if (!prevMap.has(row.competitor_domain)) {
        prevMap.set(row.competitor_domain, row.keywords_common);
      }
    }

    const movementRows = competitorDomains.map((domain) => {
      const keywordsCommon = insightMap.get(domain) ?? 0;
      const prev = prevMap.get(domain);
      return {
        brandId: payload.brandId,
        competitorDomain: domain,
        snapshotWeek: weekLabel,
        keywordsCommon,
        keywordsCommonDelta: prev != null ? keywordsCommon - prev : null,
        isNewThisWeek: prev == null,
        isLostThisWeek: false,
        sourceProvider: "dataforseo_labs",
        sourceMetadata: { dispatchContext: dispatchCtx },
        capturedAt: now,
      };
    });

    if (movementRows.length > 0) {
      await scoped.insert(competitorMovementsTable, movementRows, { onConflict: "doNothing" });
      competitorMovementsWritten = movementRows.length;
    }

    log.info(
      { competitorMovementsWritten },
      "seo.discovery.weekly: step E — competitor_movements written",
    );

    // ------------------------------------------------------------------
    // Step F — 30-day auto-archive sweep
    // Move stale pending candidates to 'archived' (is_discovery_candidate
    // stays true per Phase 0 approval — archived ≠ deleted).
    // ------------------------------------------------------------------
    const archiveResult = (await db.execute(sql`
      UPDATE keywords
      SET
        candidate_review_status = 'archived',
        candidate_reviewed_at   = now()
      WHERE brand_id = ${payload.brandId}::uuid
        AND is_discovery_candidate = true
        AND candidate_review_status = 'pending'
        AND discovered_at < now() - INTERVAL '30 days'
    `)) as unknown as { rowCount?: number; count?: number };

    const archivedStale =
      typeof archiveResult === "object" && archiveResult !== null
        ? ((archiveResult as { rowCount?: number }).rowCount ??
           (archiveResult as { count?: number }).count ??
           0)
        : 0;

    log.info(
      { archivedStale },
      "seo.discovery.weekly: step F — archive sweep complete",
    );

    // ------------------------------------------------------------------
    // Step G — success event + completion summary
    // ------------------------------------------------------------------

    // KD filter stats: combine Step B (related keywords) and Step D (competitor mining).
    // Unknown-KD keywords pass through in both steps — this is intentional and transparent.
    const totalBeforeKdFilter = rawCandidates + compBeforeKdFilter;
    const totalAfterKdFilter = afterKdFilter.length + (compBeforeKdFilter - droppedCompetitor);
    const totalDropped = droppedRelated + droppedCompetitor;
    const dropRatePct =
      totalBeforeKdFilter > 0
        ? Math.round((totalDropped / totalBeforeKdFilter) * 10_000) / 100
        : 0;

    const kdFilterStats: KdFilterStats = {
      candidatesBeforeKdFilter: totalBeforeKdFilter,
      candidatesAfterKdFilter: totalAfterKdFilter,
      droppedRelatedKeywordsStep: droppedRelated,
      droppedCompetitorMiningStep: droppedCompetitor,
      threshold: effectiveMaxKd,
      dropRatePct,
    };

    const result: DiscoveryWeeklyResult = {
      weekLabel,
      seedsExpanded: seeds.length,
      rawCandidates,
      afterDedup: rawCandidates,
      afterKdFilter: afterKdFilter.length,
      afterExistingFilter: newCandidates.length,
      insertedCandidates,
      competitorCandidatesInserted,
      competitorMovementsWritten,
      archivedStale,
      kdFilterStats,
    };

    await db.insert(eventsTable).values({
      eventType: SUCCESS_EVENT,
      brandId: payload.brandId,
      subjectType: "discovery_weekly",
      subjectId: payload.brandId,
      payload: {
        idempotencyKey: payload.idempotencyKey,
        ...result,
        // Dispatcher-requested metadata key for drop analysis.
        candidates_dropped_kd_filter: {
          related_keywords_step: droppedRelated,
          competitor_mining_step: droppedCompetitor,
          threshold: effectiveMaxKd,
        },
      },
    });

    // Completion summary — one log line with the KD filter signal.
    // Drop rate > 40% consistently → adjust threshold (dispatcher spec).
    log.info(
      {
        ...result,
        "kd_filter_summary": {
          total_before: totalBeforeKdFilter,
          total_after: totalAfterKdFilter,
          drop_rate_pct: dropRatePct,
          threshold: effectiveMaxKd,
          high_drop_rate_alert: dropRatePct > 40,
        },
      },
      [
        `seo.discovery.weekly: done`,
        `  Total candidates before KD filter: ${totalBeforeKdFilter}`,
        `  Candidates after KD filter: ${totalAfterKdFilter}`,
        `  Drop rate: ${dropRatePct}%${dropRatePct > 40 ? " ⚠ exceeds 40% — consider raising threshold" : ""}`,
      ].join("\n"),
    );

    return result;
  });
}
