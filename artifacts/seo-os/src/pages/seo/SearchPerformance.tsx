import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, MousePointerClick, Eye, Percent, Trophy,
  ExternalLink, Search, AlertCircle, Loader2,
} from "lucide-react";
import { gsc } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function fmt(n: number) {
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(1)}K`
    : String(n);
}

function pctFmt(n: number) {
  return `${(Number(n) * 100).toFixed(2)}%`;
}

function posBadge(pos: number) {
  const p = Math.round(Number(pos));
  const color =
    p <= 3 ? "bg-green-100 text-green-800 border-green-200"
    : p <= 10 ? "bg-yellow-100 text-yellow-800 border-yellow-200"
    : "bg-secondary text-ink-muted border-rule";
  return (
    <span className={`inline-block text-[11px] font-medium border rounded-full px-2 py-0.5 ${color}`}>
      #{p}
    </span>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-sm tabular-nums w-12 text-right shrink-0">{fmt(value)}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── date range preset picker ─────────────────────────────────────────────── */

function dateRange(days: number): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

const PRESETS = [
  { label: "28d", days: 28 },
  { label: "90d", days: 90 },
  { label: "6mo", days: 180 },
];

/* ── trend chart (clicks + impressions over time) ───────────────────────── */

type DateRow = { date: string; clicks: number; impressions: number };

function TrendChart({ rows }: { rows: DateRow[] }) {
  if (rows.length === 0) return null;
  const maxImp = Math.max(...rows.map((r) => r.impressions), 1);
  const maxClk = Math.max(...rows.map((r) => r.clicks), 1);

  return (
    <div className="border border-rule rounded-md bg-background p-4 mt-4">
      <div className="flex items-center gap-4 mb-3 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1 rounded-full bg-blue-400" />
          Impressions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-1 rounded-full bg-accent" />
          Clicks
        </span>
      </div>
      <div className="flex items-end gap-0.5 h-24">
        {rows.map((r) => (
          <div key={r.date} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative">
            <div
              className="w-full bg-blue-200 rounded-t-sm min-h-[1px]"
              style={{ height: `${Math.max(2, (r.impressions / maxImp) * 80)}px` }}
            />
            <div
              className="w-full bg-accent rounded-t-sm min-h-[1px] absolute bottom-0"
              style={{ height: `${Math.max(2, (r.clicks / maxClk) * 80)}px` }}
            />
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block z-10
                            bg-ink text-paper text-[10px] px-2 py-1 rounded whitespace-nowrap pointer-events-none">
              {r.date}: {r.clicks} clicks, {fmt(r.impressions)} imp.
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-ink-muted">
        <span>{rows[0]?.date?.slice(5)}</span>
        <span>{rows[rows.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────────────────── */

function SearchPerformanceInner({ brandId }: { brandId: string }) {
  const [preset, setPreset] = useState(90);
  const [dimension, setDimension] = useState<"query" | "page">("query");
  const [filter, setFilter] = useState("");
  const { dateFrom, dateTo } = dateRange(preset);

  const connQ = useQuery({
    queryKey: ["gsc", "connection", brandId],
    queryFn: () => gsc.connection(brandId),
    staleTime: 60_000,
  });

  const perfQ = useQuery({
    queryKey: ["gsc", "search-performance", brandId, dimension, dateFrom, dateTo],
    queryFn: () => gsc.searchPerformance(brandId, { dimension, dateFrom, dateTo, limit: 200 }),
    enabled: !!connQ.data?.connected && !!connQ.data?.gscPropertyUrl,
    staleTime: 300_000,
  });

  const trendQ = useQuery({
    queryKey: ["gsc", "trend", brandId, dateFrom, dateTo],
    queryFn: () => gsc.searchPerformance(brandId, { dimension: "date", dateFrom, dateTo }),
    enabled: !!connQ.data?.connected && !!connQ.data?.gscPropertyUrl,
    staleTime: 300_000,
  });

  const conn = connQ.data;
  const perf = perfQ.data;
  const trend = trendQ.data;

  const rows = (perf?.rows ?? []) as Array<{
    query?: string; page?: string;
    clicks: number; impressions: number; ctr: number; position: number;
  }>;
  const trendRows = (trend?.rows ?? []) as DateRow[];
  const totals = perf?.totals ?? { clicks: 0, impressions: 0, avgCtr: 0, avgPosition: 0 };

  const maxClicks = Math.max(...rows.map((r) => r.clicks), 1);
  const maxImpressions = Math.max(...rows.map((r) => r.impressions), 1);
  const filtered = filter
    ? rows.filter((r) => {
        const key = dimension === "query" ? r.query : r.page;
        return key?.toLowerCase().includes(filter.toLowerCase());
      })
    : rows;

  if (connQ.isLoading) {
    return <SeoShell title="Search Performance"><StateBox>Loading…</StateBox></SeoShell>;
  }

  if (!conn?.connected) {
    return (
      <SeoShell title="Search Performance" subtitle="Google Search Console data">
        <div className="border border-dashed border-rule rounded-md bg-secondary/20 p-10 text-center mt-4">
          <Search className="h-8 w-8 text-ink-muted mx-auto mb-3" />
          <p className="font-medium text-sm mb-1">Google Search Console not connected</p>
          <p className="text-xs text-ink-muted mb-4">
            Connect your Google account in Integrations to see real click and impression data.
          </p>
          <a
            href="/seo/integrations"
            className="inline-flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
          >
            Set up Integrations
          </a>
        </div>
      </SeoShell>
    );
  }

  if (conn.connected && !conn.gscPropertyUrl) {
    return (
      <SeoShell title="Search Performance">
        <StateBox>
          Google connected as <span className="font-medium text-ink">{conn.email}</span>, but no GSC property selected yet.{" "}
          <a href="/seo/integrations" className="text-accent underline">Select a property →</a>
        </StateBox>
      </SeoShell>
    );
  }

  return (
    <SeoShell
      title="Search Performance"
      subtitle={`${conn.gscPropertyUrl} · as ${conn.email}`}
      actions={
        conn.syncSchedule ? (
          <span className="text-xs text-ink-muted">
            Daily sync · next {new Date(conn.syncSchedule.nextRunAt).toLocaleString()}
          </span>
        ) : undefined
      }
    >
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <MousePointerClick className="h-4 w-4" />, label: "Total Clicks", value: fmt(totals.clicks) },
          { icon: <Eye className="h-4 w-4" />, label: "Impressions", value: fmt(totals.impressions) },
          { icon: <Percent className="h-4 w-4" />, label: "Avg CTR", value: pctFmt(totals.avgCtr) },
          { icon: <Trophy className="h-4 w-4" />, label: "Avg Position", value: totals.avgPosition.toFixed(1) },
        ].map(({ icon, label, value }) => (
          <div key={label} className="border border-rule rounded-md bg-background p-4">
            <div className="flex items-center gap-2 text-xs text-ink-muted uppercase tracking-wide">
              {icon} {label}
            </div>
            <div className="font-serif text-3xl mt-2 tracking-tight">{value}</div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      {trendRows.length > 0 && <TrendChart rows={trendRows} />}

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* Date range preset */}
        <div className="flex border border-rule rounded-sm overflow-hidden text-sm">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPreset(p.days)}
              className={`px-3 py-1.5 ${preset === p.days ? "bg-ink text-paper" : "hover:bg-secondary"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Dimension toggle */}
        <div className="flex border border-rule rounded-sm overflow-hidden text-sm">
          {(["query", "page"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDimension(d)}
              className={`px-3 py-1.5 capitalize ${dimension === d ? "bg-ink text-paper" : "hover:bg-secondary"}`}
            >
              {d === "query" ? "Queries" : "Pages"}
            </button>
          ))}
        </div>

        {/* Filter */}
        <div className="flex-1 min-w-40 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${dimension === "query" ? "queries" : "URLs"}…`}
            className="w-full pl-8 pr-3 py-1.5 border border-rule rounded-sm text-sm bg-background focus:outline-none focus:border-accent"
          />
        </div>

        <span className="text-xs text-ink-muted ml-auto">
          {filtered.length} {dimension === "query" ? "queries" : "pages"}
        </span>
      </div>

      {/* Data table */}
      <div className="mt-3 border border-rule rounded-md overflow-hidden">
        {perfQ.isLoading ? (
          <div className="p-8 text-center text-sm text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading data…
          </div>
        ) : perfQ.isError ? (
          <div className="p-8 text-center text-sm text-red-500 flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {(perfQ.error as Error).message}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-muted">
            No data for the selected period.
            {!conn.lastSync && " Run a sync to import data."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 border-b border-rule">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-ink-muted text-xs uppercase tracking-wide">
                    {dimension === "query" ? "Query" : "Page"}
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-ink-muted text-xs uppercase tracking-wide w-40">Clicks</th>
                  <th className="text-right px-4 py-2.5 font-medium text-ink-muted text-xs uppercase tracking-wide w-40">Impressions</th>
                  <th className="text-right px-4 py-2.5 font-medium text-ink-muted text-xs uppercase tracking-wide w-20">CTR</th>
                  <th className="text-right px-4 py-2.5 font-medium text-ink-muted text-xs uppercase tracking-wide w-24">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {filtered.slice(0, 100).map((row, i) => {
                  const key = dimension === "query" ? row.query : row.page;
                  return (
                    <tr key={i} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-2.5 max-w-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {dimension === "page" ? (
                            <a
                              href={key}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline truncate flex items-center gap-1 min-w-0"
                            >
                              <span className="truncate">{key}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="truncate text-ink" title={key}>{key}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <MiniBar value={row.clicks} max={maxClicks} color="bg-accent" />
                      </td>
                      <td className="px-4 py-2.5">
                        <MiniBar value={row.impressions} max={maxImpressions} color="bg-blue-400" />
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                        {pctFmt(row.ctr)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {posBadge(row.position)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <div className="px-4 py-3 border-t border-rule text-xs text-ink-muted text-center">
                Showing top 100 of {filtered.length} rows
              </div>
            )}
          </div>
        )}
      </div>

      {/* Last sync status */}
      {conn.lastSync && (
        <div className="mt-3 text-xs text-ink-muted">
          Last sync:{" "}
          <span className="font-medium text-ink">
            {new Date(conn.lastSync.started_at as string).toLocaleString()}
          </span>
          {" · "}
          {conn.lastSync.status === "done" && (
            <span className="text-green-600">
              {(conn.lastSync.query_rows_upserted as number ?? 0).toLocaleString()} query rows,{" "}
              {(conn.lastSync.page_rows_upserted as number ?? 0).toLocaleString()} page rows
            </span>
          )}
          {conn.lastSync.status === "error" && (
            <span className="text-red-500">{conn.lastSync.error_message as string}</span>
          )}
          {conn.lastSync.status === "running" && (
            <span className="text-blue-600">syncing…</span>
          )}
          {" · "}
          <a href="/seo/integrations" className="text-accent hover:underline">
            Manage connection →
          </a>
        </div>
      )}
    </SeoShell>
  );
}

export default withBrand("Search Performance", "Google Search Console analytics", (brandId) => (
  <SearchPerformanceInner brandId={brandId} />
));
