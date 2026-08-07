import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

type GapRow = {
  id: string;
  keyword: string;
  intents: string[] | null;
  volume: number | null;
  kd: number | null;
  cpc: string | null;
  our_url: string | null;
  our_position: number | null;
  competitor_domain: string;
  competitor_url: string | null;
  competitor_position: number | null;
  competitor_traffic: number | null;
  priority_score: number | null;
};

type GapSummary = {
  total: number;
  high_opp: number;
  total_comp_traffic: number;
};

const INTENTS = ["Informational", "Commercial", "Transactional", "Navigational"] as const;
type Intent = (typeof INTENTS)[number];

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    Informational: "bg-blue-100 text-blue-700",
    Commercial: "bg-purple-100 text-purple-700",
    Transactional: "bg-green-100 text-green-700",
    Navigational: "bg-orange-100 text-orange-700",
    Branded: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-medium mr-1 ${colors[intent] ?? "bg-secondary text-ink-muted"}`}
    >
      {intent.slice(0, 1)}
    </span>
  );
}

function PriorityBar({ score, max }: { score: number | null; max: number }) {
  if (!score || max === 0) return <span className="text-ink-muted">—</span>;
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs w-10 text-right">{score.toLocaleString()}</span>
    </div>
  );
}

function DetailPanel({ row, onClose }: { row: GapRow; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-background border-l border-rule shadow-xl z-40 overflow-y-auto">
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-medium text-sm leading-tight pr-4">{row.keyword}</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink shrink-0">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Intents</dt>
            <dd className="mt-1">
              {row.intents?.map((i) => <IntentBadge key={i} intent={i} />) ?? "—"}
            </dd>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Volume</dt>
              <dd className="font-mono text-sm">{row.volume?.toLocaleString() ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">KD</dt>
              <dd className="font-mono text-sm">{row.kd ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">CPC</dt>
              <dd className="font-mono text-sm">{row.cpc ? `$${row.cpc}` : "—"}</dd>
            </div>
          </div>

          <div className="border-t border-rule pt-3">
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">Our ranking</dt>
            {row.our_position ? (
              <dd className="text-sm">
                <span className="font-mono font-medium">#{row.our_position}</span>
                {row.our_url && (
                  <a
                    href={row.our_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-accent hover:underline mt-0.5 truncate"
                  >
                    {row.our_url}
                  </a>
                )}
              </dd>
            ) : (
              <dd className="text-xs text-red-600">Not ranked</dd>
            )}
          </div>

          <div className="border-t border-rule pt-3">
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">Competitor</dt>
            <dd>
              <span className="font-medium text-sm">{row.competitor_domain}</span>
              <span className="text-ink-muted ml-2 text-xs">#{row.competitor_position}</span>
              {row.competitor_url && (
                <a
                  href={row.competitor_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs text-accent hover:underline mt-0.5 truncate"
                >
                  {row.competitor_url}
                </a>
              )}
              {row.competitor_traffic != null && (
                <div className="text-xs text-ink-muted mt-0.5">
                  ~{row.competitor_traffic.toLocaleString()} traffic/mo
                </div>
              )}
            </dd>
          </div>

          <div className="border-t border-rule pt-3">
            <dt className="text-[11px] uppercase tracking-wide text-ink-muted">Priority score</dt>
            <dd className="font-mono text-lg font-medium">{row.priority_score?.toLocaleString() ?? "—"}</dd>
            <dd className="text-xs text-ink-muted mt-0.5">volume × (1 − KD/100)</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function ContentGapInner({ brandId }: { brandId: string }) {
  const [intent, setIntent] = useState<Intent | "">("");
  const [minVolume, setMinVolume] = useState<number | "">("");
  const [maxKd, setMaxKd] = useState<number | "">(100);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedRow, setSelectedRow] = useState<GapRow | null>(null);
  const LIMIT = 50;

  const params = {
    intent: intent || undefined,
    minVolume: minVolume !== "" ? Number(minVolume) : undefined,
    maxKd: maxKd !== "" && maxKd !== 100 ? Number(maxKd) : undefined,
    search: appliedSearch || undefined,
    limit: LIMIT,
    offset,
  };

  const gapQ = useQuery({
    queryKey: ["seo", "content-gap", brandId, params],
    queryFn: () => seo.listContentGap(brandId, params),
    staleTime: 60_000,
  });

  const summary: GapSummary = gapQ.data?.summary as GapSummary ?? { total: 0, high_opp: 0, total_comp_traffic: 0 };
  const gaps: GapRow[] = (gapQ.data?.gaps ?? []) as GapRow[];
  const maxScore = gaps.reduce((m, g) => Math.max(m, g.priority_score ?? 0), 0);

  async function exportCsv() {
    try {
      const csv = await seo.exportContentGap(brandId, {
        intent: intent || undefined,
        minVolume: minVolume !== "" ? Number(minVolume) : undefined,
        maxKd: maxKd !== "" && maxKd !== 100 ? Number(maxKd) : undefined,
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "content-gap.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Failed to export CSV");
    }
  }

  return (
    <>
      {selectedRow && (
        <DetailPanel row={selectedRow} onClose={() => setSelectedRow(null)} />
      )}
      <SeoShell
        title="Content Gap"
        subtitle="Keywords competitors rank for that TekRevol doesn't"
        actions={
          <button
            onClick={() => void exportCsv()}
            className="flex items-center gap-2 border border-rule rounded-sm px-3 py-1.5 text-sm hover:bg-secondary"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        }
      >
        {/* Summary bar */}
        {summary.total > 0 && (
          <div className="flex items-center gap-6 mb-5 p-3 bg-secondary/40 rounded-md text-sm flex-wrap">
            <span>
              <span className="font-medium text-ink">{summary.total.toLocaleString()}</span>
              <span className="text-ink-muted ml-1">total gaps</span>
            </span>
            <span>
              <span className="font-medium text-green-600">{summary.high_opp.toLocaleString()}</span>
              <span className="text-ink-muted ml-1">high-opportunity (Vol≥1K, KD≤50)</span>
            </span>
            <span>
              <span className="font-medium text-ink">~{(summary.total_comp_traffic ?? 0).toLocaleString()}</span>
              <span className="text-ink-muted ml-1">competitor traffic at stake</span>
            </span>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-4 items-end">
          {/* Intent */}
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">Intent</label>
            <select
              value={intent}
              onChange={(e) => { setIntent(e.target.value as Intent | ""); setOffset(0); }}
              className="input text-sm !py-1.5"
            >
              <option value="">All intents</option>
              {INTENTS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          {/* Min volume */}
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">Min volume</label>
            <input
              type="number"
              min="0"
              value={minVolume}
              onChange={(e) => { setMinVolume(e.target.value === "" ? "" : Number(e.target.value)); setOffset(0); }}
              placeholder="0"
              className="input text-sm !py-1.5 w-24"
            />
          </div>

          {/* Max KD */}
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
              Max KD: <span className="font-medium text-ink">{maxKd}</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={maxKd}
              onChange={(e) => { setMaxKd(Number(e.target.value)); setOffset(0); }}
              className="w-32 accent-accent"
            />
          </div>

          {/* Keyword search */}
          <div className="flex-1 min-w-[12rem]">
            <label className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">Search</label>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search); setOffset(0); } }}
                placeholder="Keyword…"
                className="input text-sm !py-1.5 flex-1"
              />
              <button
                onClick={() => { setAppliedSearch(search); setOffset(0); }}
                className="bg-ink text-paper px-3 py-1.5 rounded-sm text-xs hover:bg-accent"
              >
                Go
              </button>
            </div>
          </div>
        </div>

        {/* Table */}
        {gapQ.isLoading ? (
          <StateBox>Loading content gaps…</StateBox>
        ) : gaps.length === 0 && summary.total === 0 ? (
          <StateBox>
            No content gap data. Upload the Ahrefs ContentGap export from the Dashboard.
          </StateBox>
        ) : gaps.length === 0 ? (
          <StateBox>No gaps match this filter.</StateBox>
        ) : (
          <>
            <div className="border border-rule rounded-md bg-background overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Keyword</th>
                    <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Intent</th>
                    <th className="text-right font-medium px-4 py-2">Volume</th>
                    <th className="text-right font-medium px-4 py-2">KD</th>
                    <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Priority</th>
                    <th className="text-left font-medium px-4 py-2 hidden lg:table-cell">Competitor</th>
                    <th className="text-right font-medium px-4 py-2 hidden lg:table-cell">Comp #</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((g) => (
                    <tr
                      key={g.id}
                      className="border-t border-rule hover:bg-secondary/30 cursor-pointer"
                      onClick={() => setSelectedRow(g)}
                    >
                      <td className="px-4 py-2 font-medium max-w-[16rem] truncate">
                        {g.keyword}
                        {!g.our_position && (
                          <span className="ml-2 text-[10px] text-red-500 font-normal">not ranked</span>
                        )}
                      </td>
                      <td className="px-4 py-2 hidden sm:table-cell">
                        {g.intents?.slice(0, 2).map((i) => <IntentBadge key={i} intent={i} />) ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {g.volume?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        <span className={g.kd != null && g.kd <= 50 ? "text-green-600" : g.kd != null && g.kd >= 70 ? "text-red-500" : ""}>
                          {g.kd ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2 hidden md:table-cell">
                        <PriorityBar score={g.priority_score} max={maxScore} />
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-muted hidden lg:table-cell">
                        {g.competitor_domain}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs hidden lg:table-cell">
                        #{g.competitor_position ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3 text-xs text-ink-muted">
              <span>
                Showing {offset + 1}–{offset + gaps.length} of {summary.total.toLocaleString()}
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
                  disabled={gaps.length < LIMIT}
                  className="px-3 py-1 border border-rule rounded-sm disabled:opacity-40 hover:bg-secondary"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </SeoShell>
    </>
  );
}

export default withBrand("Content Gap", undefined, (brandId) => (
  <ContentGapInner brandId={brandId} />
));
