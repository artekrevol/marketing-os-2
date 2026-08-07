/**
 * Thin fetch wrapper that uses Clerk's session cookie for auth and routes
 * to the api-server through the shared reverse proxy. The api-server
 * artifact already mounts at `/api` so we always hit `/api/...` —
 * regardless of which artifact (`/seo-os/`, `/insight-forge/`) is the
 * current page — because the proxy resolves paths most-specific-first.
 */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers, credentials: "include" });
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.message || body.error || detail;
    } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

// ---- Quality Gate ----

export type QueueItem = {
  id: string;
  title: string | null;
  status: string;
  word_count: number | null;
  updated_at: string;
  qa_run: {
    id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
  } | null;
};

export type CheckResult = {
  id: string;
  qa_run_id: string;
  check_key: string;
  severity: "hard_fail" | "warn" | "info";
  passed: boolean | null;
  threshold: number | null;
  observed: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type ReviewDetail = {
  contentObject: {
    id: string;
    brand_id: string;
    project_id: string | null;
    draft_id: string | null;
    title: string | null;
    body_md: string | null;
    word_count: number | null;
    status: string;
    submitted_at: string | null;
    decided_at: string | null;
    submitted_by: string | null;
    decided_by: string | null;
  };
  qaRun: {
    id: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    summary: Record<string, unknown> | null;
  } | null;
  checks: CheckResult[];
  signoffs: Array<{
    id: string;
    decision: string;
    comment: string | null;
    reviewer_id: string;
    decided_at: string;
  }>;
  overrides: Array<{
    id: string;
    check_key: string;
    reason: string;
    overrider_id: string;
    created_at: string;
  }>;
};

export const qualityGate = {
  listQueue: async (brandId: string): Promise<{ items: QueueItem[] }> =>
    jsonOrThrow(
      await authedFetch(`/api/quality-gate/queue?brandId=${encodeURIComponent(brandId)}`),
    ),

  getReview: async (brandId: string, contentObjectId: string): Promise<ReviewDetail> =>
    jsonOrThrow(
      await authedFetch(
        `/api/quality-gate/review?contentObjectId=${encodeURIComponent(contentObjectId)}&brandId=${encodeURIComponent(brandId)}`,
      ),
    ),

  submit: async (brandId: string, contentObjectId: string) =>
    jsonOrThrow<{ qaRunId: string; idempotencyKey: string }>(
      await authedFetch(`/api/quality-gate/submit`, {
        method: "POST",
        body: JSON.stringify({ brandId, contentObjectId }),
      }),
    ),

  decide: async (
    brandId: string,
    contentObjectId: string,
    decision: "approved" | "rejected",
    comment?: string,
  ) =>
    jsonOrThrow<{ status: string }>(
      await authedFetch(`/api/quality-gate/decide`, {
        method: "POST",
        body: JSON.stringify({ brandId, contentObjectId, decision, comment }),
      }),
    ),

  startFromDraft: async (brandId: string, projectId: string) =>
    jsonOrThrow<{ contentObjectId: string; source: "created" | "reused" }>(
      await authedFetch(`/api/quality-gate/start-from-draft`, {
        method: "POST",
        body: JSON.stringify({ brandId, projectId }),
      }),
    ),
};

// ---- Recovery War Room ----

export type RecoveryBaseline = {
  id: string;
  brand_id: string;
  baseline_date: string;
  baseline_gsc_clicks_daily: string | null;
  baseline_ga4_sessions_daily: string | null;
  baseline_avg_position: string;
  baseline_keywords_in_top_10: number;
  baseline_keywords_in_top_3: number;
  locked_at: string;
  locked_by: string;
  notes: string | null;
};

export type RecoverySnapshot = {
  id: string;
  brand_id: string;
  snapshot_date: string;
  gsc_clicks_30d_avg: string | null;
  ga4_sessions_30d_avg: string | null;
  avg_position_30d: string;
  keywords_in_top_10: number;
  keywords_in_top_3: number;
  gap_to_baseline_clicks_pct: string | null;
  gap_to_baseline_position: string | null;
  gap_to_baseline_top10_pct: string | null;
  computed_at: string;
};

export type RecoveryInitiative = {
  id: string;
  brand_id: string;
  name: string;
  type: string;
  description: string | null;
  expected_impact_pct: string | null;
  expected_impact_clicks: number | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  actual_impact_clicks_14d: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type RecoveryProjection =
  | {
      status: "projecting";
      slope: number;
      intercept: number;
      latestGapPct: number;
      projectedRecoveryDate: string;
      pointsUsed: number;
    }
  | {
      status: "recovered";
      slope: number;
      intercept: number;
      latestGapPct: number;
      pointsUsed: number;
    }
  | {
      status: "gap_widening";
      slope: number;
      intercept: number;
      latestGapPct: number;
      pointsUsed: number;
    }
  | {
      status: "no_data";
      reason: "all_null" | "insufficient_points" | "no_variance";
      pointsUsed: number;
    };

export type RecoveryOverview = {
  baseline: RecoveryBaseline | null;
  current: RecoverySnapshot | null;
  gapPct: number | null;
  activeInitiatives: number;
  projection: RecoveryProjection;
};

// The api-server returns Drizzle camelCase; the UI types here use the
// snake_case wire shape. The api-server actually serialises `baseline`
// rows as-is from Drizzle (camelCase), so we normalise in the client
// for stable consumption.
type CamelKeys<T> = T extends RecoveryBaseline
  ? {
      id: string;
      brandId: string;
      baselineDate: string;
      baselineGscClicksDaily: string | null;
      baselineGa4SessionsDaily: string | null;
      baselineAvgPosition: string;
      baselineKeywordsInTop10: number;
      baselineKeywordsInTop3: number;
      lockedAt: string;
      lockedBy: string;
      notes: string | null;
    }
  : never;

function normaliseBaseline(b: CamelKeys<RecoveryBaseline> | null): RecoveryBaseline | null {
  if (!b) return null;
  return {
    id: b.id,
    brand_id: b.brandId,
    baseline_date: b.baselineDate,
    baseline_gsc_clicks_daily: b.baselineGscClicksDaily,
    baseline_ga4_sessions_daily: b.baselineGa4SessionsDaily,
    baseline_avg_position: b.baselineAvgPosition,
    baseline_keywords_in_top_10: b.baselineKeywordsInTop10,
    baseline_keywords_in_top_3: b.baselineKeywordsInTop3,
    locked_at: b.lockedAt,
    locked_by: b.lockedBy,
    notes: b.notes,
  };
}

type CamelSnap = {
  id: string;
  brandId: string;
  snapshotDate: string;
  gscClicks30dAvg: string | null;
  ga4Sessions30dAvg: string | null;
  avgPosition30d: string;
  keywordsInTop10: number;
  keywordsInTop3: number;
  gapToBaselineClicksPct: string | null;
  gapToBaselinePosition: string | null;
  gapToBaselineTop10Pct: string | null;
  computedAt: string;
};

function normaliseSnapshot(s: CamelSnap | null): RecoverySnapshot | null {
  if (!s) return null;
  return {
    id: s.id,
    brand_id: s.brandId,
    snapshot_date: s.snapshotDate,
    gsc_clicks_30d_avg: s.gscClicks30dAvg,
    ga4_sessions_30d_avg: s.ga4Sessions30dAvg,
    avg_position_30d: s.avgPosition30d,
    keywords_in_top_10: s.keywordsInTop10,
    keywords_in_top_3: s.keywordsInTop3,
    gap_to_baseline_clicks_pct: s.gapToBaselineClicksPct,
    gap_to_baseline_position: s.gapToBaselinePosition,
    gap_to_baseline_top10_pct: s.gapToBaselineTop10Pct,
    computed_at: s.computedAt,
  };
}

type CamelInit = {
  id: string;
  brandId: string;
  name: string;
  type: string;
  description: string | null;
  expectedImpactPct: string | null;
  expectedImpactClicks: number | null;
  startedAt: string;
  completedAt: string | null;
  status: string;
  actualImpactClicks14d: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function normaliseInitiative(i: CamelInit): RecoveryInitiative {
  return {
    id: i.id,
    brand_id: i.brandId,
    name: i.name,
    type: i.type,
    description: i.description,
    expected_impact_pct: i.expectedImpactPct,
    expected_impact_clicks: i.expectedImpactClicks,
    started_at: i.startedAt,
    completed_at: i.completedAt,
    status: i.status,
    actual_impact_clicks_14d: i.actualImpactClicks14d,
    created_by: i.createdBy,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
  };
}

export const recovery = {
  overview: async (brandId: string): Promise<RecoveryOverview> => {
    const raw = await jsonOrThrow<{
      baseline: CamelKeys<RecoveryBaseline> | null;
      current: CamelSnap | null;
      gapPct: number | null;
      activeInitiatives: number;
      projection: RecoveryProjection;
    }>(await authedFetch(`/api/recovery/overview/${encodeURIComponent(brandId)}`));
    return {
      baseline: normaliseBaseline(raw.baseline),
      current: normaliseSnapshot(raw.current),
      gapPct: raw.gapPct,
      activeInitiatives: raw.activeInitiatives,
      projection: raw.projection,
    };
  },
  snapshots: async (brandId: string, days = 90): Promise<RecoverySnapshot[]> => {
    const raw = await jsonOrThrow<{ snapshots: CamelSnap[] }>(
      await authedFetch(
        `/api/recovery/snapshots/${encodeURIComponent(brandId)}?days=${days}`,
      ),
    );
    return raw.snapshots.map((s) => normaliseSnapshot(s)!);
  },
  initiatives: async (brandId: string): Promise<RecoveryInitiative[]> => {
    const raw = await jsonOrThrow<{ initiatives: CamelInit[] }>(
      await authedFetch(`/api/recovery/initiatives/${encodeURIComponent(brandId)}`),
    );
    return raw.initiatives.map(normaliseInitiative);
  },

  // ---- Initiative mutations (Prompt 6) ----
  // Each helper returns the freshly-mutated initiative in snake_case so
  // it slots straight into existing UI without further translation.

  createInitiative: async (input: {
    brandId: string;
    name: string;
    type: string;
    description?: string | null;
    expectedImpactPct?: number | null;
    expectedImpactClicks?: number | null;
    startedAt: string;
  }): Promise<RecoveryInitiative> => {
    const raw = await jsonOrThrow<{ initiative: CamelInit }>(
      await authedFetch(`/api/recovery/initiatives`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    return normaliseInitiative(raw.initiative);
  },

  updateInitiative: async (
    id: string,
    input: {
      brandId: string;
      name?: string;
      type?: string;
      description?: string | null;
      expectedImpactPct?: number | null;
      expectedImpactClicks?: number | null;
      startedAt?: string;
      status?: "active" | "abandoned";
    },
  ): Promise<RecoveryInitiative> => {
    const raw = await jsonOrThrow<{ initiative: CamelInit }>(
      await authedFetch(`/api/recovery/initiatives/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    );
    return normaliseInitiative(raw.initiative);
  },

  completeInitiative: async (
    id: string,
    input: { brandId: string; completionNotes?: string },
  ): Promise<RecoveryInitiative> => {
    const raw = await jsonOrThrow<{ initiative: CamelInit }>(
      await authedFetch(
        `/api/recovery/initiatives/${encodeURIComponent(id)}/complete`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    );
    return normaliseInitiative(raw.initiative);
  },

  abandonInitiative: async (
    id: string,
    input: { brandId: string; reason: string },
  ): Promise<RecoveryInitiative> => {
    const raw = await jsonOrThrow<{ initiative: CamelInit }>(
      await authedFetch(
        `/api/recovery/initiatives/${encodeURIComponent(id)}/abandon`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    );
    return normaliseInitiative(raw.initiative);
  },

  exportPdf: async (brandId: string): Promise<void> => {
    const res = await authedFetch(
      `/api/recovery/export/${encodeURIComponent(brandId)}.pdf`,
    );
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { error?: string; message?: string };
        detail = body.message || body.error || detail;
      } catch {}
      throw new Error(`${res.status} ${detail}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disp = res.headers.get("content-disposition");
    const match = disp?.match(/filename="?([^"]+)"?/);
    a.download = match?.[1] ?? `recovery-${brandId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// ---- SEO Intelligence ----
// The api-server serialises Drizzle rows as-is (camelCase). Raw-SQL
// endpoints (`rankings/current`, `dashboard/stats`) return snake_case
// aliases; those shapes are typed explicitly below.

export type SeoLocation = {
  id: string;
  brandId: string;
  name: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  dataforseoLocationCode: number;
  languageCode: string;
  createdAt: string;
  updatedAt: string;
};

export type SeoKeywordList = {
  id: string;
  brandId: string;
  name: string;
  parentListId: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SeoKeyword = {
  id: string;
  brandId: string;
  keywordText: string;
  listId: string | null;
  locationId: string;
  searchVolume: number | null;
  cpc: string | null;
  competition: string | null;
  linkedContentCount: number;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Ahrefs-enriched fields (populated when organic_keywords XLSX is ingested)
  ahrefsKeywordDifficulty: string | null;
  ahrefsSumTraffic: number | null;
  ahrefsIntentFlags: Record<string, boolean> | null;
};

export type SeoBlacklistedDomain = {
  id: string;
  brandId: string;
  domain: string;
  reason: string | null;
  createdAt: string;
};

export type SeoCompetitorPage = {
  id: string;
  brandId: string;
  competitorDomain: string;
  url: string;
  keywordId: string | null;
  position: number | null;
  capturedAt: string;
};

export type SeoCompetitorInsight = {
  id: string;
  brandId: string;
  competitorDomain: string;
  sharedKeywordCount: number;
  averagePosition: string | null;
  topKeywords: unknown;
  lastComputedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Row returned by GET /api/seo/competitor-curation (snake_case from DB) */
export type SeoCompetitorCurationRow = {
  id: string;
  competitor_domain: string;
  shared_keyword_count: number | null;
  ahrefs_domain_rating: string | number | null;
  ahrefs_keywords_common: number | null;
  is_relevant_competitor: boolean | null;
  exclusion_reason: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by: string | null;
  last_computed_at: string | null;
  created_at: string;
};

export type SeoCrawlBatch = {
  id: string;
  brandId: string;
  status: string;
  keywordCount: number;
  completedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type SeoRankSnapshot = {
  id: string;
  brandId: string;
  keywordId: string;
  locationId: string;
  batchId: string | null;
  position: number | null;
  url: string | null;
  foundAtPosition: boolean;
  serpFeatures: unknown;
  capturedAt: string;
};

export type SeoCrawlSchedule = {
  id: string;
  brandId: string;
  listId: string | null;
  cronExpression: string;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SeoCurrentRanking = {
  keyword_id: string;
  keyword_text: string;
  location_id: string;
  position: number | null;
  url: string | null;
  found_at_position: boolean;
  captured_at: string;
};

export type SeoDashboardStats = {
  keyword_count: number;
  location_count: number;
  competitor_count: number;
  active_schedule_count: number;
  last_crawl_at: string | null;
};

const qs = (brandId: string, extra: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({ brandId });
  for (const [k, v] of Object.entries(extra)) if (v != null) p.set(k, v);
  return p.toString();
};

export const seo = {
  // ----- Dashboard -----
  dashboardStats: async (brandId: string): Promise<SeoDashboardStats | null> =>
    (
      await jsonOrThrow<{ stats: SeoDashboardStats | null }>(
        await authedFetch(`/api/seo/dashboard/stats?${qs(brandId)}`),
      )
    ).stats,

  // ----- Locations -----
  listLocations: async (brandId: string): Promise<SeoLocation[]> =>
    (
      await jsonOrThrow<{ locations: SeoLocation[] }>(
        await authedFetch(`/api/seo/locations?${qs(brandId)}`),
      )
    ).locations,
  createLocation: async (input: {
    brandId: string;
    name: string;
    dataforseoLocationCode: number;
    countryCode?: string | null;
    region?: string | null;
    city?: string | null;
    languageCode?: string;
  }): Promise<SeoLocation> =>
    (
      await jsonOrThrow<{ location: SeoLocation }>(
        await authedFetch(`/api/seo/locations`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      )
    ).location,
  deleteLocation: async (brandId: string, id: string): Promise<void> => {
    await jsonOrThrow(
      await authedFetch(`/api/seo/locations/${encodeURIComponent(id)}?${qs(brandId)}`, {
        method: "DELETE",
      }),
    );
  },

  // ----- Keyword lists -----
  listKeywordLists: async (brandId: string): Promise<SeoKeywordList[]> =>
    (
      await jsonOrThrow<{ keywordLists: SeoKeywordList[] }>(
        await authedFetch(`/api/seo/keyword-lists?${qs(brandId)}`),
      )
    ).keywordLists,
  createKeywordList: async (input: {
    brandId: string;
    name: string;
    parentListId?: string | null;
    description?: string | null;
  }): Promise<SeoKeywordList> =>
    (
      await jsonOrThrow<{ keywordList: SeoKeywordList }>(
        await authedFetch(`/api/seo/keyword-lists`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      )
    ).keywordList,
  deleteKeywordList: async (brandId: string, id: string): Promise<void> => {
    await jsonOrThrow(
      await authedFetch(`/api/seo/keyword-lists/${encodeURIComponent(id)}?${qs(brandId)}`, {
        method: "DELETE",
      }),
    );
  },

  // ----- Keywords -----
  listKeywords: async (brandId: string, listId?: string): Promise<SeoKeyword[]> =>
    (
      await jsonOrThrow<{ keywords: SeoKeyword[] }>(
        await authedFetch(`/api/seo/keywords?${qs(brandId, { listId })}`),
      )
    ).keywords,
  createKeyword: async (input: {
    brandId: string;
    keywordText: string;
    locationId: string;
    listId?: string | null;
  }): Promise<SeoKeyword> =>
    (
      await jsonOrThrow<{ keyword: SeoKeyword }>(
        await authedFetch(`/api/seo/keywords`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      )
    ).keyword,
  bulkCreateKeywords: async (input: {
    brandId: string;
    keywords: Array<{ keywordText: string; locationId: string; listId?: string | null }>;
  }): Promise<{ keywords: SeoKeyword[]; inserted: number }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/keywords/bulk`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  deleteKeyword: async (brandId: string, id: string): Promise<void> => {
    await jsonOrThrow(
      await authedFetch(`/api/seo/keywords/${encodeURIComponent(id)}?${qs(brandId)}`, {
        method: "DELETE",
      }),
    );
  },

  // ----- Crawls -----
  createCrawl: async (input: {
    brandId: string;
    keywordIds?: string[];
  }): Promise<{ batchId: string; keywordCount: number }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/crawls`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  crawlStatus: async (brandId: string): Promise<SeoCrawlBatch[]> =>
    (
      await jsonOrThrow<{ batches: SeoCrawlBatch[] }>(
        await authedFetch(`/api/seo/crawls/status?${qs(brandId)}`),
      )
    ).batches,

  // ----- Rankings -----
  currentRankings: async (brandId: string): Promise<SeoCurrentRanking[]> =>
    (
      await jsonOrThrow<{ rankings: SeoCurrentRanking[] }>(
        await authedFetch(`/api/seo/rankings/current?${qs(brandId)}`),
      )
    ).rankings,
  rankingHistory: async (brandId: string, keywordId: string): Promise<SeoRankSnapshot[]> =>
    (
      await jsonOrThrow<{ history: SeoRankSnapshot[] }>(
        await authedFetch(`/api/seo/rankings/history?${qs(brandId, { keywordId })}`),
      )
    ).history,

  // ----- Competitors -----
  listCompetitorPages: async (brandId: string, domain?: string): Promise<SeoCompetitorPage[]> =>
    (
      await jsonOrThrow<{ competitorPages: SeoCompetitorPage[] }>(
        await authedFetch(`/api/seo/competitor-pages?${qs(brandId, { domain })}`),
      )
    ).competitorPages,
  discoverCompetitors: async (input: {
    brandId: string;
    keywordIds?: string[];
  }): Promise<{ jobId: string }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/competitor-pages/discover`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),

  // ----- Discovery Inbox -----
  listDiscoveryCandidates: async (
    brandId: string,
    status?: string,
  ): Promise<import("@/pages/seo/DiscoveryInbox").DiscoveryCandidate[]> =>
    (
      await jsonOrThrow<{ candidates: import("@/pages/seo/DiscoveryInbox").DiscoveryCandidate[] }>(
        await authedFetch(
          `/api/seo/discovery-inbox?${qs(brandId, status ? { status } : {})}`,
        ),
      )
    ).candidates,

  reviewCandidate: async (
    brandId: string,
    keywordId: string,
    decision: string,
  ): Promise<{ ok: boolean; keywordId: string; decision: string }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/discovery-inbox/review`, {
        method: "POST",
        body: JSON.stringify({ brandId, keywordId, decision }),
      }),
    ),

  reviewCandidatesBulk: async (
    brandId: string,
    keywordIds: string[],
    decision: string,
  ): Promise<{ ok: boolean; updated: number; decision: string }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/discovery-inbox/review-bulk`, {
        method: "POST",
        body: JSON.stringify({ brandId, keywordIds, decision }),
      }),
    ),

  // ----- Competitor Curation -----
  listCompetitorCuration: async (
    brandId: string,
    filter?: string,
  ): Promise<SeoCompetitorCurationRow[]> =>
    (
      await jsonOrThrow<{ competitors: SeoCompetitorCurationRow[] }>(
        await authedFetch(
          `/api/seo/competitor-curation?${qs(brandId, filter ? { filter } : {})}`,
        ),
      )
    ).competitors,

  updateCompetitorCuration: async (
    brandId: string,
    id: string,
    isRelevantCompetitor: boolean,
    exclusionReason?: string | null,
  ): Promise<{ ok: boolean; id: string; isRelevantCompetitor: boolean }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/competitor-curation/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ brandId, isRelevantCompetitor, exclusionReason }),
      }),
    ),

  bulkMarkIrrelevant: async (
    brandId: string,
    ids: string[],
    exclusionReason: string | null,
  ): Promise<{ ok: boolean; updated: number }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/competitor-curation/bulk-mark-irrelevant`, {
        method: "POST",
        body: JSON.stringify({ brandId, ids, exclusionReason }),
      }),
    ),

  // ----- Competitor insights -----
  listCompetitorInsights: async (brandId: string): Promise<SeoCompetitorInsight[]> =>
    (
      await jsonOrThrow<{ competitorInsights: SeoCompetitorInsight[] }>(
        await authedFetch(`/api/seo/competitor-insights?${qs(brandId)}`),
      )
    ).competitorInsights,
  computeCompetitorInsights: async (brandId: string): Promise<{ jobId: string }> =>
    jsonOrThrow(
      await authedFetch(`/api/seo/competitor-insights/compute`, {
        method: "POST",
        body: JSON.stringify({ brandId }),
      }),
    ),

  // ----- Ahrefs Intelligence -----
  ahrefsUpload: async (
    brandId: string,
    files: File[],
  ): Promise<{
    batchId: string;
    imported: Record<string, number>;
    delta: { newLinks: number; lostLinks: number; newGapKeywords: number; pagesRecovered: number; pagesCrashed: number };
  }> => {
    const form = new FormData();
    form.append("brandId", brandId);
    for (const f of files) form.append("files", f);
    const res = await authedFetch("/api/seo/ahrefs/upload", { method: "POST", body: form });
    return jsonOrThrow(res);
  },

  ahrefsSummary: async (brandId: string) =>
    jsonOrThrow<{
      latestBatch: { id: string; imported_at: string; backlink_count: number; page_count: number; content_gap_count: number; delta_new_links: number; delta_lost_links: number; delta_pages_crashed: number } | null;
      crashedPages: Array<{ url: string; prev_traffic: number | null; curr_traffic: number | null; traffic_change: number | null; status: string | null }>;
      brokenHighDrLinks: Array<{ referring_page_url: string; target_url: string | null; dr: string | null; anchor: string | null; domain: string }>;
      topGapOpportunities: Array<{ keyword: string; volume: number | null; kd: number | null; priority_score: number | null; competitor_domain: string; competitor_position: number | null }>;
      linkVelocity: { new_links: number; lost_links: number };
    }>(await authedFetch(`/api/seo/ahrefs/summary?${qs(brandId)}`)),

  listBacklinks: async (
    brandId: string,
    params: { isLost?: string; isSpam?: string; isNofollow?: string; minDr?: number; search?: string; limit?: number; offset?: number },
  ) =>
    jsonOrThrow<{ stats: Record<string, number>; backlinks: unknown[]; limit: number; offset: number }>(
      await authedFetch(
        `/api/seo/backlinks?${qs(brandId, {
          ...(params.isLost      !== undefined && { isLost:     params.isLost }),
          ...(params.isSpam      !== undefined && { isSpam:     params.isSpam }),
          ...(params.isNofollow  !== undefined && { isNofollow: params.isNofollow }),
          ...(params.minDr       !== undefined && { minDr:      String(params.minDr) }),
          ...(params.search && { search: params.search }),
          limit:  String(params.limit  ?? 50),
          offset: String(params.offset ?? 0),
        })}`,
      ),
    ),

  brokenBacklinks: async (brandId: string) =>
    jsonOrThrow<{ brokenLinks: unknown[] }>(
      await authedFetch(`/api/seo/backlinks/broken?${qs(brandId)}`),
    ),

  exportRedirectList: async (brandId: string): Promise<string> => {
    const res = await authedFetch(`/api/seo/backlinks/broken/export?${qs(brandId)}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },

  drDistribution: async (brandId: string) =>
    jsonOrThrow<{ distribution: Record<string, number> }>(
      await authedFetch(`/api/seo/backlinks/dr-distribution?${qs(brandId)}`),
    ),

  listAnchors: async (brandId: string, params?: { limit?: number }) =>
    jsonOrThrow<{ anchors: unknown[] }>(
      await authedFetch(
        `/api/seo/anchors?${qs(brandId, { limit: String(params?.limit ?? 50) })}`,
      ),
    ),

  pagePerformance: async (
    brandId: string,
    params?: { status?: string; minDrop?: number; limit?: number; offset?: number },
  ) =>
    jsonOrThrow<{ pages: unknown[] }>(
      await authedFetch(
        `/api/seo/page-performance?${qs(brandId, {
          ...(params?.status && { status: params.status }),
          ...(params?.minDrop !== undefined && { minDrop: String(params.minDrop) }),
          limit: String(params?.limit ?? 100),
          offset: String(params?.offset ?? 0),
        })}`,
      ),
    ),

  listContentGap: async (
    brandId: string,
    params: { intent?: string; minVolume?: number; maxKd?: number; search?: string; limit?: number; offset?: number },
  ) =>
    jsonOrThrow<{ summary: Record<string, number>; gaps: unknown[]; limit: number; offset: number }>(
      await authedFetch(
        `/api/seo/content-gap?${qs(brandId, {
          ...(params.intent && { intent: params.intent }),
          ...(params.minVolume !== undefined && { minVolume: String(params.minVolume) }),
          ...(params.maxKd !== undefined && { maxKd: String(params.maxKd) }),
          ...(params.search && { search: params.search }),
          limit: String(params.limit ?? 50),
          offset: String(params.offset ?? 0),
        })}`,
      ),
    ),

  exportContentGap: async (
    brandId: string,
    params: { intent?: string; minVolume?: number; maxKd?: number },
  ): Promise<string> => {
    const res = await authedFetch(
      `/api/seo/content-gap/export?${qs(brandId, {
        ...(params.intent && { intent: params.intent }),
        ...(params.minVolume !== undefined && { minVolume: String(params.minVolume) }),
        ...(params.maxKd !== undefined && { maxKd: String(params.maxKd) }),
      })}`,
    );
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  },

  // ----- Schedules -----
  listSchedules: async (brandId: string): Promise<SeoCrawlSchedule[]> =>
    (
      await jsonOrThrow<{ schedules: SeoCrawlSchedule[] }>(
        await authedFetch(`/api/seo/schedules?${qs(brandId)}`),
      )
    ).schedules,
  createSchedule: async (input: {
    brandId: string;
    cronExpression: string;
    listId?: string | null;
    active?: boolean;
  }): Promise<SeoCrawlSchedule> =>
    (
      await jsonOrThrow<{ schedule: SeoCrawlSchedule }>(
        await authedFetch(`/api/seo/schedules`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      )
    ).schedule,
  updateSchedule: async (
    id: string,
    input: { brandId: string; cronExpression?: string; listId?: string | null; active?: boolean },
  ): Promise<SeoCrawlSchedule> =>
    (
      await jsonOrThrow<{ schedule: SeoCrawlSchedule }>(
        await authedFetch(`/api/seo/schedules/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      )
    ).schedule,
  deleteSchedule: async (brandId: string, id: string): Promise<void> => {
    await jsonOrThrow(
      await authedFetch(`/api/seo/schedules/${encodeURIComponent(id)}?${qs(brandId)}`, {
        method: "DELETE",
      }),
    );
  },
};

// ---- Cross-module reads (Shared Data Layer) ----

export type CrossDataSource = {
  module: "content-forge" | "seo-os" | "system";
  generatedAt: string;
  isFresh: boolean;
  staleAfterDays: number;
  refreshAction?: "crawl" | "manual" | null;
};

export type CrossResult<T> = {
  data: T;
  source: CrossDataSource | null;
  reason:
    | null
    | "not-yet-tracked"
    | "never-crawled"
    | "not-published"
    | "no-rankings"
    | "no-competitors"
    | "stale"
    | "system-error";
};

export type LinkedContentItem = {
  projectId: string;
  title: string;
  status: string;
  publishedUrl: string | null;
  attachedAt: string;
  isCanonical: boolean;
};

export const crossModule = {
  /** Articles (ContentForge) linked to a given SEO keyword. */
  contentForKeyword: async (
    brandId: string,
    keywordId: string,
  ): Promise<CrossResult<LinkedContentItem[]>> =>
    jsonOrThrow<CrossResult<LinkedContentItem[]>>(
      await authedFetch(
        `/api/cross-module/content-for-keyword?${qs(brandId, { keywordId })}`,
      ),
    ),
};
