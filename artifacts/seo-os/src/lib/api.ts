import { supabase } from "./supabase";

/**
 * Thin fetch wrapper that attaches the Supabase access token and routes
 * to the api-server through the shared reverse proxy. The api-server
 * artifact already mounts at `/api` so we always hit `/api/...` —
 * regardless of which artifact (`/seo-os/`, `/insight-forge/`) is the
 * current page — because the proxy resolves paths most-specific-first.
 */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers });
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
  methodology: string;
  baseline_gsc_clicks_daily: string | null;
  baseline_ga4_sessions_daily: string | null;
  baseline_avg_position: string;
  baseline_keywords_in_top_10: number;
  baseline_keywords_in_top_3: number;
  recovery_threshold_pct: string;
  recovery_consecutive_days: number;
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
      methodology: string;
      baselineGscClicksDaily: string | null;
      baselineGa4SessionsDaily: string | null;
      baselineAvgPosition: string;
      baselineKeywordsInTop10: number;
      baselineKeywordsInTop3: number;
      recoveryThresholdPct: string;
      recoveryConsecutiveDays: number;
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
    methodology: b.methodology,
    baseline_gsc_clicks_daily: b.baselineGscClicksDaily,
    baseline_ga4_sessions_daily: b.baselineGa4SessionsDaily,
    baseline_avg_position: b.baselineAvgPosition,
    baseline_keywords_in_top_10: b.baselineKeywordsInTop10,
    baseline_keywords_in_top_3: b.baselineKeywordsInTop3,
    recovery_threshold_pct: b.recoveryThresholdPct,
    recovery_consecutive_days: b.recoveryConsecutiveDays,
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
};
