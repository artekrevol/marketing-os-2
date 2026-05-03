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
