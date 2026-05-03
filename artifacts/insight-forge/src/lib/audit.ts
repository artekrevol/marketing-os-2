import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * Admin-sensitive audit log. Justification is mandatory at the DB level
 * — the trim()>0 check constraint will reject empty strings. Caller is
 * expected to surface a "Why?" prompt before invoking this.
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };
    const { error } = await supabase.from("audit_log").insert({
      action,
      target_type: targetType,
      target_id: targetId,
      justification: justification.trim(),
      metadata: metadata as Json,
      brand_id: brandId,
      actor_id: user.id,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "audit insert failed" };
  }
}
