/**
 * Typed client for the Express AI routes (`/api/ai/*`).
 *
 * Drop-in replacement for `supabase.functions.invoke(name, { body })`.
 * Returns `{ data, error }` so existing call-sites need only swap the
 * import — no other structural changes required.
 *
 * Auth: reads the active Supabase session and forwards the JWT as
 * `Authorization: Bearer <token>`. The Express `requireAuth` middleware
 * validates it via SUPABASE_JWT_SECRET.
 */

import { supabase } from "@/integrations/supabase/client";

type AiResult<T = unknown> = { data: T | null; error: { message: string } | null };

async function callAi<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<AiResult<T>> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token ?? "";

    const resp = await fetch(`/api/ai/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const json = (await resp.json()) as Record<string, unknown>;

    if (!resp.ok || json["error"]) {
      return {
        data: null,
        error: { message: String(json["error"] ?? `HTTP ${resp.status}`) },
      };
    }

    return { data: json as T, error: null };
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    };
  }
}

export const aiClient = {
  proposeBrief: (project_id: string) =>
    callAi("propose-brief", { project_id }),

  researchGenerate: (project_id: string) =>
    callAi("research-generate", { project_id }),

  researchRetryCard: (project_id: string, stage: string) =>
    callAi("research-retry-card", { project_id, stage }),

  outlineGenerate: (project_id: string) =>
    callAi("outline-generate", { project_id }),

  draftSection: (project_id: string, section_id: string, revision_instruction?: string) =>
    callAi("draft-section", { project_id, section_id, ...(revision_instruction ? { revision_instruction } : {}) }),

  interviewStep: (project_id: string, section_id: string, last_answer?: string) =>
    callAi("interview-step", { project_id, section_id, ...(last_answer != null ? { last_answer } : {}) }),

  finalStitch: (project_id: string) =>
    callAi("final-stitch", { project_id }),

  playbookUpload: (filename: string, mime_type: string, content_base64: string, uploaded_by: string | null) =>
    callAi("playbook-upload", { filename, mime_type, content_base64, uploaded_by }),

  playbookReparse: () =>
    callAi("playbook-reparse", {}),
};
