import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { ExternalLink } from "lucide-react";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

type BacklinkRow = {
  id: string;
  referring_page_url: string;
  referring_page_title: string | null;
  dr: string | null;
  ur: string | null;
  anchor: string | null;
  target_url: string | null;
  link_type: string | null;
  is_nofollow: boolean;
  is_spam: boolean;
  is_lost: boolean;
  first_seen: string | null;
  last_seen: string | null;
  page_type: string | null;
};

type AnchorRow = {
  id: string;
  anchor_text: string;
  ref_domains_count: number | null;
  top_dr: number | null;
  ref_pages_count: number | null;
  dofollow_links: number | null;
};

type BacklinkStats = {
  total: number;
  active: number;
  lost: number;
  dofollow: number;
  spam: number;
};

type DrDistribution = {
  "90plus": number;
  "70to89": number;
  "50to69": number;
  "30to49": number;
  sub30: number;
};

type FilterState = "all" | "active" | "lost" | "spam" | "nofollow";

const DR_BUCKETS = [
  { key: "90plus",  label: "DR 90+",   color: "#16a34a" },
  { key: "70to89",  label: "DR 70–89", color: "#65a30d" },
  { key: "50to69",  label: "DR 50–69", color: "#ca8a04" },
  { key: "30to49",  label: "DR 30–49", color: "#ea580c" },
  { key: "sub30",   label: "DR <30",   color: "#dc2626" },
] as const;

function BacklinksInner({ brandId }: { brandId: string }) {
  const [filter, setFilter] = useState<FilterState>("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const queryParams = {
    isLost:     filter === "lost"     ? "true" : filter === "active" ? "false" : undefined,
    isSpam:     filter === "spam"     ? "true" : undefined,
    isNofollow: filter === "nofollow" ? "true" : undefined,
    search: debouncedSearch || undefined,
    limit: LIMIT,
    offset,
  };

  const backlinksQ = useQuery({
    queryKey: ["seo", "backlinks", brandId, queryParams],
    queryFn: () => seo.listBacklinks(brandId, queryParams),
    staleTime: 60_000,
  });

  const anchorsQ = useQuery({
    queryKey: ["seo", "anchors", brandId],
    queryFn: () => seo.listAnchors(brandId, { limit: 20 }),
    staleTime: 60_000,
  });

  const drQ = useQuery({
    queryKey: ["seo", "backlinks-dr", brandId],
    queryFn: () => seo.drDistribution(brandId),
    staleTime: 60_000,
  });

  const stats: BacklinkStats = backlinksQ.data?.stats as BacklinkStats ?? { total: 0, active: 0, lost: 0, dofollow: 0, spam: 0 };
  const rows: BacklinkRow[] = (backlinksQ.data?.backlinks ?? []) as BacklinkRow[];
  const anchors: AnchorRow[] = (anchorsQ.data?.anchors ?? []) as AnchorRow[];
  const dist: DrDistribution = drQ.data?.distribution as DrDistribution ?? {};

  const drChartData = DR_BUCKETS.map((b) => ({
    label: b.label,
    count: dist[b.key] ?? 0,
    color: b.color,
  }));

  const hasData = stats.total > 0;

  return (
    <SeoShell
      title="Backlinks"
      subtitle="Link profile overview from Ahrefs exports"
    >
      {/* Stat strip */}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Total links", value: stats.total },
            { label: "Active", value: stats.active },
            { label: "Lost", value: stats.lost },
            { label: "Dofollow", value: stats.dofollow },
            { label: "Spam", value: stats.spam },
          ].map((s) => (
            <div key={s.label} className="border border-rule rounded-md bg-background p-3 text-center">
              <div className="text-xs text-ink-muted uppercase tracking-wide">{s.label}</div>
              <div className="font-serif text-2xl mt-1">{(s.value ?? 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* DR distribution chart */}
      {hasData && drChartData.some((d) => d.count > 0) && (
        <div className="border border-rule rounded-md bg-background p-4 mb-6">
          <div className="text-xs text-ink-muted uppercase tracking-wide mb-3">DR Distribution (active links)</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={drChartData} barSize={32}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 4 }}
                formatter={(v: number) => [v.toLocaleString(), "links"]}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {drChartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Anchor text top 20 */}
      {anchors.length > 0 && (
        <div className="border border-rule rounded-md bg-background overflow-hidden mb-6">
          <div className="px-4 py-2 border-b border-rule bg-secondary/40 text-xs text-ink-muted uppercase tracking-wide">
            Top anchor texts
          </div>
          <table className="w-full text-sm">
            <thead className="text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Anchor</th>
                <th className="text-right font-medium px-4 py-2">Ref domains</th>
                <th className="text-right font-medium px-4 py-2 hidden md:table-cell">Dofollow</th>
                <th className="text-right font-medium px-4 py-2 hidden md:table-cell">Top DR</th>
              </tr>
            </thead>
            <tbody>
              {anchors.slice(0, 10).map((a) => (
                <tr key={a.id} className="border-t border-rule hover:bg-secondary/30">
                  <td className="px-4 py-2 font-medium max-w-xs truncate">{a.anchor_text || "(empty)"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{a.ref_domains_count?.toLocaleString() ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs hidden md:table-cell">{a.dofollow_links?.toLocaleString() ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs hidden md:table-cell">{a.top_dr ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full backlink table */}
      <div>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          {/* Filter tabs */}
          <div className="flex gap-1">
            {(["all", "active", "lost", "spam", "nofollow"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setOffset(0); }}
                className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors capitalize ${
                  filter === f
                    ? "bg-ink text-paper"
                    : "border border-rule text-ink-muted hover:bg-secondary"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => { setDebouncedSearch(search); setOffset(0); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setDebouncedSearch(search); setOffset(0); } }}
            placeholder="Search URL or anchor…"
            className="input text-sm flex-1 max-w-xs"
          />
        </div>

        {backlinksQ.isLoading ? (
          <StateBox>Loading backlinks…</StateBox>
        ) : rows.length === 0 && !hasData ? (
          <StateBox>
            No backlink data. Upload the Ahrefs Backlinks export from the Dashboard.
          </StateBox>
        ) : rows.length === 0 ? (
          <StateBox>No backlinks match this filter.</StateBox>
        ) : (
          <>
            <div className="border border-rule rounded-md bg-background overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Referring page</th>
                    <th className="text-left font-medium px-4 py-2">DR</th>
                    <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Anchor</th>
                    <th className="text-left font-medium px-4 py-2 hidden lg:table-cell">Target</th>
                    <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Type</th>
                    <th className="text-left font-medium px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className={`border-t border-rule hover:bg-secondary/30 ${b.is_lost ? "opacity-60" : ""}`}>
                      <td className="px-4 py-2 max-w-xs">
                        <a
                          href={b.referring_page_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline text-xs"
                        >
                          <span className="truncate max-w-[200px]">
                            {b.referring_page_title || b.referring_page_url}
                          </span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs font-medium">{b.dr ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-ink-muted max-w-[10rem] truncate hidden md:table-cell">
                        {b.anchor ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-muted max-w-[12rem] truncate hidden lg:table-cell">
                        {b.target_url ? (() => { try { return new URL(b.target_url).pathname; } catch { return b.target_url; } })() : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-muted hidden md:table-cell">{b.link_type ?? "—"}</td>
                      <td className="px-4 py-2">
                        {b.is_lost ? (
                          <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] bg-red-100 text-red-700">Lost</span>
                        ) : b.is_spam ? (
                          <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-700">Spam</span>
                        ) : b.is_nofollow ? (
                          <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] bg-secondary text-ink-muted">Nofollow</span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3 text-xs text-ink-muted">
              <span>
                Showing {offset + 1}–{offset + rows.length} of {stats.total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                  className="px-3 py-1 border border-rule rounded-sm disabled:opacity-40 hover:bg-secondary"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={rows.length < LIMIT}
                  className="px-3 py-1 border border-rule rounded-sm disabled:opacity-40 hover:bg-secondary"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </SeoShell>
  );
}

export default withBrand("Backlinks", undefined, (brandId) => (
  <BacklinksInner brandId={brandId} />
));
