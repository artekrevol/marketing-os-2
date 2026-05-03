import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * Append-only event log helper. Fire-and-forget — failures are logged to
 * the console but never block the caller, since the event log is for
 * observability, not flow control. Event types are conventionally
 * snake_case.<verb>, e.g. "project.created", "draft.saved".
 */
export async function emit(
  eventType: string,
  subjectType: string | null,
  subjectId: string | null,
  payload: Record<string, unknown> = {},
  brandId: string | null = null,
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("events").insert({
      event_type: eventType,
      subject_type: subjectType,
      subject_id: subjectId,
      payload: payload as Json,
      brand_id: brandId,
      actor_id: user.id,
    });
    if (error) console.warn("[events.emit]", eventType, error.message);
  } catch (e) {
    console.warn("[events.emit] threw", e);
  }
}
