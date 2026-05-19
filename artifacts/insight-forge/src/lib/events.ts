/**
 * Append-only event log helper. Fire-and-forget — failures are logged to
 * the console but never block the caller.
 */
export async function emit(
  eventType: string,
  subjectType: string | null,
  subjectId: string | null,
  payload: Record<string, unknown> = {},
  brandId: string | null = null,
): Promise<void> {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ eventType, subjectType, subjectId, payload, brandId }),
    });
  } catch (e) {
    console.warn("[events.emit] threw", e);
  }
}
