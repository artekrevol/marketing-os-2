/**
 * <DataSourceTag> — mandatory attribution for every cross-module read.
 *
 * Design rule #3 of the Shared Data Layer: when one module surfaces data that
 * originated in another (SEO OS rankings shown inside ContentForge, linked
 * articles shown inside SEO OS), the UI must always say WHERE the data came
 * from and HOW FRESH it is. This component renders that badge.
 *
 * Types are duplicated (not imported from @workspace/db) on purpose: the
 * frontends must never import server/DB code. The shapes mirror
 * `lib/db/src/queries/types.ts` and match the JSON returned by the
 * cross-module API routes (note `generatedAt` arrives as an ISO string).
 */

export type DataSourceModule = "content-forge" | "seo-os" | "system";

export type DataSourceLite = {
  module: DataSourceModule;
  generatedAt: string | Date;
  isFresh: boolean;
  staleAfterDays: number;
  refreshAction?: "crawl" | "manual" | null;
};

export type QueryReason =
  | null
  | "not-yet-tracked"
  | "never-crawled"
  | "not-published"
  | "no-rankings"
  | "no-competitors"
  | "stale"
  | "system-error";

const MODULE_LABEL: Record<DataSourceModule, string> = {
  "content-forge": "ContentForge",
  "seo-os": "SEO OS",
  system: "System",
};

/** Human, lowercase phrasing for each empty-state reason. */
export const REASON_LABEL: Record<NonNullable<QueryReason>, string> = {
  "not-yet-tracked": "not yet tracked",
  "never-crawled": "never crawled",
  "not-published": "not published yet",
  "no-rankings": "no rankings yet",
  "no-competitors": "no competitors found",
  stale: "data may be stale",
  "system-error": "couldn’t load",
};

function relativeAge(from: string | Date): string {
  const then = new Date(from).getTime();
  if (Number.isNaN(then)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function DataSourceTag({
  source,
  reason,
  className = "",
}: {
  source: DataSourceLite | null;
  reason?: QueryReason;
  className?: string;
}) {
  // No source: the parent is showing an empty state. Echo the reason quietly
  // (staleness is the one reason that still ships with a source, handled below).
  if (!source) {
    if (!reason) return null;
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-400 ${className}`}
        title={REASON_LABEL[reason]}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" aria-hidden />
        {REASON_LABEL[reason]}
      </span>
    );
  }

  const stale = !source.isFresh;
  const dot = stale ? "bg-amber-500" : "bg-emerald-500";
  const label = MODULE_LABEL[source.module];
  const age = relativeAge(source.generatedAt);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] tracking-wide text-gray-500 ${className}`}
      title={
        stale
          ? `${label} · ${age} · past ${source.staleAfterDays}-day freshness window`
          : `${label} · updated ${age}`
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      <span className="font-medium text-gray-600">{label}</span>
      <span aria-hidden>·</span>
      <span>{age}</span>
      {stale && (
        <span className="uppercase font-medium text-amber-600">stale</span>
      )}
    </span>
  );
}
