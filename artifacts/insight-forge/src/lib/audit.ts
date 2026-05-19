/**
 * Admin-sensitive audit log. Justification is mandatory.
 */
export async function recordAudit(
  action: string,
  targetType: string | null,
  targetId: string | null,
  justification: string,
  metadata: Record<string, unknown> = {},
  brandId: string | null = null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!justification || !justification.trim()) {
    return { ok: false, error: "Justification is required." };
  }
  try {
    const resp = await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action, targetType, targetId, justification: justification.trim(), metadata, brandId }),
    });
    if (!resp.ok) {
      const j = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: String(j["error"] ?? `HTTP ${resp.status}`) };
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "audit insert failed";
    return { ok: false, error: msg };
  }
}
