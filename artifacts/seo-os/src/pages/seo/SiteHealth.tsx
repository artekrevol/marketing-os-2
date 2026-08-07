import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, Link2, Copy, CheckCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

type PageRow = {
  id: string;
  url: string;
  status: string | null;
  ur: string | null;
  prev_traffic: number | null;
  curr_traffic: number | null;
  traffic_change: number | null;
  curr_ref_domains: number | null;
  page_type: string | null;
};

type BrokenLinkRow = {
  id: string;
  referring_page_url: string;
  referring_page_title: string | null;
  dr: string | null;
  anchor: string | null;
  target_url: string | null;
  referring_domain: string;
};

type StatusFilter = "all" | "Lost" | "crashed" | "Active";

function pctChange(prev: number | null, change: number | null): number | null {
  if (!prev || prev === 0) return null;
  if (change == null) return null;
  return Math.round((change / prev) * 100);
}

function StatusBadge({ status, pct }: { status: string | null; pct: number | null }) {
  if (status === "Lost") {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
        Lost
      </span>
    );
  }
  if (pct != null && pct <= -50) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
        −{Math.abs(pct)}%
      </span>
    );
  }
  if (pct != null && pct <= -30) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
        −{Math.abs(pct)}%
      </span>
    );
  }
  if (pct != null && pct > 0) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
        +{pct}%
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-ink-muted">
      {status ?? "Stable"}
    </span>
  );
}

function SiteHealthInner({ brandId }: { brandId: string }) {
  const [pageFilter, setPageFilter] = useState<StatusFilter>("all");
  const [copied, setCopied] = useState(false);

  const pagesQ = useQuery({
    queryKey: ["seo", "page-performance", brandId, pageFilter],
    queryFn: () => {
      const statusParam = pageFilter === "crashed" ? undefined : pageFilter === "all" ? undefined : pageFilter;
      const minDropParam = pageFilter === "crashed" ? -500 : undefined;
      return seo.pagePerformance(brandId, { status: statusParam, minDrop: minDropParam });
    },
    staleTime: 60_000,
  });

  const brokenQ = useQuery({
    queryKey: ["seo", "backlinks-broken", brandId],
    queryFn: () => seo.brokenBacklinks(brandId),
    staleTime: 60_000,
  });

  const pages: PageRow[] = (pagesQ.data?.pages ?? []) as PageRow[];
  const broken: BrokenLinkRow[] = (brokenQ.data?.brokenLinks ?? []) as BrokenLinkRow[];

  // Filter pages client-side for "crashed" (>50% drop)
  const filteredPages = pageFilter === "crashed"
    ? pages.filter((p) => {
        const pct = pctChange(p.prev_traffic, p.traffic_change);
        return pct != null && pct <= -50;
      })
    : pages;

  const lostCount = pages.filter((p) => p.status === "Lost").length;
  const crashedCount = pages.filter((p) => {
    const pct = pctChange(p.prev_traffic, p.traffic_change);
    return pct != null && pct <= -50;
  }).length;

  async function copyRedirectList() {
    try {
      const text = await seo.exportRedirectList(brandId);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Redirect list copied to clipboard");
    } catch (e) {
      toast.error("Failed to copy redirect list");
    }
  }

  return (
    <SeoShell
      title="Site Health"
      subtitle="Traffic crashes and broken backlink opportunities"
    >
      {/* Traffic section */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            <h2 className="font-medium text-sm">Traffic Performance</h2>
          </div>
          {pages.length > 0 && (
            <p className="text-xs text-ink-muted">
              {lostCount} pages lost · {crashedCount} crashed (&gt;50%)
            </p>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4">
          {(["all", "Lost", "crashed", "Active"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPageFilter(f)}
              className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                pageFilter === f
                  ? "bg-ink text-paper"
                  : "border border-rule text-ink-muted hover:bg-secondary"
              }`}
            >
              {f === "all" ? "All" : f === "crashed" ? "Crashed (>50%)" : f}
            </button>
          ))}
        </div>

        {pagesQ.isLoading ? (
          <StateBox>Loading page performance…</StateBox>
        ) : pages.length === 0 ? (
          <StateBox>
            No page performance data. Upload the Ahrefs TopPages export from the Dashboard.
          </StateBox>
        ) : filteredPages.length === 0 ? (
          <StateBox>No pages match this filter.</StateBox>
        ) : (
          <div className="border border-rule rounded-md bg-background overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2">URL</th>
                  <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Type</th>
                  <th className="text-right font-medium px-4 py-2">Prev traffic</th>
                  <th className="text-right font-medium px-4 py-2">Curr traffic</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-right font-medium px-4 py-2 hidden lg:table-cell">Ref domains</th>
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((p) => {
                  const pct = pctChange(p.prev_traffic, p.traffic_change);
                  const urlPath = (() => { try { return new URL(p.url).pathname; } catch { return p.url; } })();
                  const rowClass =
                    p.status === "Lost" || (pct != null && pct <= -50)
                      ? "bg-red-50/40"
                      : pct != null && pct <= -30
                      ? "bg-amber-50/40"
                      : pct != null && pct > 0
                      ? "bg-green-50/40"
                      : "";
                  return (
                    <tr key={p.id} className={`border-t border-rule ${rowClass}`}>
                      <td className="px-4 py-2">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline font-medium max-w-xs truncate"
                        >
                          <span className="truncate">{urlPath}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-2 text-ink-muted hidden md:table-cell">{p.page_type ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {p.prev_traffic?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {p.curr_traffic?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={p.status} pct={pct} />
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-ink-muted hidden lg:table-cell">
                        {p.curr_ref_domains?.toLocaleString() ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Broken backlinks section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-amber-500" />
            <h2 className="font-medium text-sm">Broken Backlinks (DR 40+)</h2>
          </div>
          {broken.length > 0 && (
            <button
              onClick={() => void copyRedirectList()}
              className="flex items-center gap-1.5 text-xs border border-rule rounded-sm px-3 py-1.5 hover:bg-secondary transition-colors"
            >
              {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy nginx redirect list"}
            </button>
          )}
        </div>

        {brokenQ.isLoading ? (
          <StateBox>Loading broken backlinks…</StateBox>
        ) : broken.length === 0 ? (
          <StateBox>
            No high-DR broken backlinks found. Upload the Ahrefs Backlinks export from the Dashboard.
          </StateBox>
        ) : (
          <div className="border border-rule rounded-md bg-background overflow-hidden">
            <div className="px-4 py-2 bg-amber-50 border-b border-rule text-xs text-amber-700">
              {broken.length} links from DR 40+ domains point to broken targets — fix with 301 redirects to recover link equity.
            </div>
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Linking domain</th>
                  <th className="text-left font-medium px-4 py-2">DR</th>
                  <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Anchor</th>
                  <th className="text-left font-medium px-4 py-2">Dead target</th>
                </tr>
              </thead>
              <tbody>
                {broken.map((b) => {
                  const targetPath = (() => { try { return new URL(b.target_url ?? "").pathname; } catch { return b.target_url ?? "—"; } })();
                  return (
                    <tr key={b.id} className="border-t border-rule hover:bg-secondary/30">
                      <td className="px-4 py-2">
                        <a
                          href={b.referring_page_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline text-xs"
                        >
                          {b.referring_domain}
                        </a>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs font-medium">{b.dr ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-ink-muted max-w-[12rem] truncate hidden md:table-cell">
                        {b.anchor ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-red-600 max-w-[16rem] truncate">
                        {targetPath}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SeoShell>
  );
}

export default withBrand("Site Health", undefined, (brandId) => (
  <SiteHealthInner brandId={brandId} />
));
