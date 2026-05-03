/**
 * Shared types & constants for the recovery initiative modals.
 * Lives outside the modal component files so the type list is the
 * single source of truth — kept in sync with `recoveryInitiativeType`
 * in `lib/db/src/schema/recovery/initiatives.ts` and the
 * `RecoveryInitiativeTypeEnum` in the OpenAPI spec.
 */

export const INITIATIVE_TYPES: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "content_refresh", label: "Content refresh" },
  { value: "content_kill", label: "Content kill" },
  { value: "content_consolidation", label: "Content consolidation" },
  { value: "technical_fix", label: "Technical fix" },
  { value: "link_building", label: "Link building" },
  { value: "quality_gate", label: "Quality gate" },
  { value: "other", label: "Other" },
];

export function typeLabel(value: string): string {
  return INITIATIVE_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** Format an ISO timestamp as `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
export function toDatetimeLocal(iso: string | undefined | null): string {
  if (!iso) {
    const now = new Date();
    const tz = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tz).toISOString().slice(0, 16);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

/** Convert a `<input type="datetime-local">` value back into a UTC ISO. */
export function fromDatetimeLocal(local: string): string {
  return new Date(local).toISOString();
}
