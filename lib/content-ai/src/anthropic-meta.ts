/**
 * Builds the `metadata.user_id` string sent on every Anthropic call.
 *
 * Format: `${pod}__${stage}__${substage}__${writer_id}`
 *
 * This string is the only field Anthropic surfaces in Console > Logs,
 * so encode the calling feature inside it. The same string is also
 * persisted in `usage_logs.metadata_user_id` so our internal dashboard
 * and the Anthropic console agree.
 *
 * - Components are sanitized to `[a-z0-9_]` (lowercased, non-allowed chars
 *   become `_`) so the string is safe to filter on in the console.
 * - Missing components fall back to `unknown`.
 * - Result is capped at 256 chars (Anthropic's metadata.user_id limit).
 */
export function buildAnthropicUserId(parts: {
  pod?: string | null;
  stage: string;
  substage: string;
  writer_id?: string | null;
}): string {
  const norm = (s: string | null | undefined, fallback: string) => {
    const v = (s ?? "").toString().trim().toLowerCase();
    if (!v) return fallback;
    return v.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
  };
  const pod = norm(parts.pod, "admin");
  const stage = norm(parts.stage, "unknown");
  const substage = norm(parts.substage, "unknown");
  const writer = norm(parts.writer_id, "anon");
  const id = `${pod}__${stage}__${substage}__${writer}`;
  return id.length > 256 ? id.slice(0, 256) : id;
}

/** Convenience: build the full Anthropic metadata object. */
export function buildAnthropicMetadata(parts: {
  pod?: string | null;
  stage: string;
  substage: string;
  writer_id?: string | null;
}): { user_id: string } {
  return { user_id: buildAnthropicUserId(parts) };
}
