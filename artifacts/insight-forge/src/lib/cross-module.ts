/**
 * ContentForge's client for the Shared Data Layer cross-module routes.
 *
 * Mirrors seo-os's pattern: a thin cookie-authed fetch wrapper hitting the
 * api-server at `/api/cross-module/*` through the shared proxy. The read
 * endpoints return the standard `{ data, source, reason }` envelope so the
 * caller can render <DataSourceTag> and explicit empty states.
 */
import type { DataSourceLite, QueryReason } from "@workspace/ui-shared";

export type CrossResult<T> = {
  data: T;
  source: DataSourceLite | null;
  reason: QueryReason;
};

export type KeywordContext = {
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  currentRanking: number | null;
  currentUrl: string | null;
  topCompetitors: Array<{ domain: string; position: number; url: string }>;
};

export type LinkedKeyword = {
  keywordId: string;
  keywordText: string;
  currentRanking: number | null;
  volume: number | null;
  isCanonical: boolean;
};

export type CrossLocation = { id: string; name: string };

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, v);
  return p.toString();
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      detail = j.message || j.error || detail;
    } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export const crossModule = {
  listLocations: async (brandId: string): Promise<CrossLocation[]> =>
    (
      await getJson<{ locations: CrossLocation[] }>(
        `/api/cross-module/locations?${qs({ brandId })}`,
      )
    ).locations,

  keywordContext: (
    brandId: string,
    keywordText: string,
    locationId?: string,
  ): Promise<CrossResult<KeywordContext>> =>
    getJson<CrossResult<KeywordContext>>(
      `/api/cross-module/keyword-context?${qs({ brandId, keywordText, locationId })}`,
    ),

  keywordsForContent: (
    brandId: string,
    projectId: string,
  ): Promise<CrossResult<LinkedKeyword[]>> =>
    getJson<CrossResult<LinkedKeyword[]>>(
      `/api/cross-module/keywords-for-content?${qs({ brandId, projectId })}`,
    ),

  trackKeyword: (input: {
    brandId: string;
    keywordText: string;
    locationId: string;
  }): Promise<{ keywordId: string; created: boolean }> =>
    postJson("/api/cross-module/track-keyword", input),

  attach: (input: {
    brandId: string;
    projectId: string;
    keywordText: string;
    locationId?: string | null;
    isCanonical?: boolean;
  }): Promise<{ keywordId: string; linkId: string }> =>
    postJson("/api/cross-module/attach", input),
};
