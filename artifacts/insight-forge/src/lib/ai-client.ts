/**
 * Typed client for the Express AI routes (`/api/ai/*`).
 * Uses cookie-based auth (Clerk session via credentials: "include").
 */

type AiResult<T = unknown> = { data: T | null; error: { message: string } | null };

async function callAi<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<AiResult<T>> {
  try {
    const resp = await fetch(`/api/ai/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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
