import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Square, Minus, ToggleLeft, ToggleRight, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { seo, type SeoCompetitorCurationRow } from "@/lib/api";
import { useActiveBrand } from "@/lib/brands";
import { SeoShell, StateBox } from "./_shell";

type CurationFilter = "all" | "relevant" | "irrelevant" | "never_reviewed";

const FILTER_TABS: { value: CurationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "relevant", label: "Relevant" },
  { value: "irrelevant", label: "Irrelevant" },
  { value: "never_reviewed", label: "Never Reviewed" },
];

/* ------------------------------------------------------------------ *
 * Inline exclusion reason editor
 * ------------------------------------------------------------------ */
function ReasonCell({
  value,
  onSave,
  disabled,
}: {
  value: string | null;
  onSave: (reason: string | null) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (!editing) {
    return (
      <div className="flex items-center gap-1 group">
        <span className="text-xs text-ink-muted truncate max-w-[160px]">
          {value || <span className="italic">—</span>}
        </span>
        {!disabled && (
          <button
            onClick={() => { setDraft(value ?? ""); setEditing(true); }}
            className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-ink transition-opacity"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(draft.trim() || null); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        className="border border-rule rounded px-1.5 py-0.5 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-ink"
        placeholder="e.g. Directory site"
        maxLength={200}
      />
      <button
        onClick={() => { onSave(draft.trim() || null); setEditing(false); }}
        className="text-green-600 hover:text-green-700"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => setEditing(false)} className="text-ink-muted hover:text-ink">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Inner component
 * ------------------------------------------------------------------ */
function CompetitorCurationInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<CurationFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");
  const [showBulkPanel, setShowBulkPanel] = useState(false);

  const competitorsQ = useQuery({
    queryKey: ["seo", "competitor-curation", brandId, filter],
    queryFn: () => seo.listCompetitorCuration(brandId, filter),
    staleTime: 30_000,
  });

  const toggleM = useMutation({
    mutationFn: ({
      id,
      isRelevantCompetitor,
      exclusionReason,
    }: {
      id: string;
      isRelevantCompetitor: boolean;
      exclusionReason?: string | null;
    }) => seo.updateCompetitorCuration(brandId, id, isRelevantCompetitor, exclusionReason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["seo", "competitor-curation", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkM = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string | null }) =>
      seo.bulkMarkIrrelevant(brandId, ids, reason),
    onSuccess: (data) => {
      toast.success(`${data.updated} competitors marked irrelevant`);
      setSelected(new Set());
      setShowBulkPanel(false);
      setBulkReason("");
      void qc.invalidateQueries({ queryKey: ["seo", "competitor-curation", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const competitors: SeoCompetitorCurationRow[] = competitorsQ.data ?? [];
  const allIds = competitors.map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <SeoShell
      title="Competitor Curation"
      subtitle="Manage which competitor domains are included in keyword discovery and movement tracking"
    >
      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setFilter(tab.value); setSelected(new Set()); }}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === tab.value
                ? "bg-ink text-paper border-ink"
                : "bg-background text-ink-muted border-rule hover:border-ink-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
        {competitorsQ.data && (
          <span className="text-xs text-ink-muted ml-2">{competitors.length} competitors</span>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="mb-3 px-4 py-3 bg-secondary/60 border border-rule rounded-md text-sm">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-medium">{selected.size} selected</span>
            <button
              onClick={() => setShowBulkPanel(!showBulkPanel)}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
            >
              Mark irrelevant
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-ink-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
          {showBulkPanel && (
            <div className="flex items-center gap-2 pt-2 border-t border-rule">
              <input
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder="Shared exclusion reason (optional)"
                className="flex-1 border border-rule rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ink"
                maxLength={200}
              />
              <button
                onClick={() =>
                  bulkM.mutate({
                    ids: Array.from(selected),
                    reason: bulkReason.trim() || null,
                  })
                }
                disabled={bulkM.isPending}
                className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {bulkM.isPending ? "Saving…" : "Confirm"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {competitorsQ.isLoading ? (
        <StateBox>Loading competitors…</StateBox>
      ) : competitors.length === 0 ? (
        <StateBox>No competitors found for this filter.</StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 w-8">
                  <button onClick={toggleAll} className="text-ink-muted hover:text-ink">
                    {allSelected ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : someSelected ? (
                      <Minus className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="text-left font-medium px-3 py-2">Domain</th>
                <th className="text-right font-medium px-3 py-2">Shared KW</th>
                <th className="text-right font-medium px-3 py-2">DR</th>
                <th className="text-center font-medium px-3 py-2">Relevant</th>
                <th className="text-left font-medium px-3 py-2">Exclusion Reason</th>
                <th className="text-left font-medium px-3 py-2">Reviewed</th>
                <th className="text-left font-medium px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-rule hover:bg-secondary/20 ${
                    selected.has(c.id) ? "bg-secondary/40" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleOne(c.id)}
                      className="text-ink-muted hover:text-ink"
                    >
                      {selected.has(c.id) ? (
                        <CheckSquare className="h-4 w-4 text-ink" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium font-mono text-xs">
                    {c.competitor_domain}
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-xs">
                    {c.shared_keyword_count ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-right text-xs">
                    {c.ahrefs_domain_rating != null
                      ? Number(c.ahrefs_domain_rating).toFixed(0)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() =>
                        toggleM.mutate({
                          id: c.id,
                          isRelevantCompetitor: !c.is_relevant_competitor,
                        })
                      }
                      disabled={toggleM.isPending}
                      title={
                        c.is_relevant_competitor
                          ? "Mark as irrelevant"
                          : "Mark as relevant"
                      }
                      className="inline-flex items-center justify-center text-ink-muted hover:text-ink disabled:opacity-40 transition-colors"
                    >
                      {c.is_relevant_competitor ? (
                        <ToggleRight className="h-5 w-5 text-green-600" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-zinc-400" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <ReasonCell
                      value={c.exclusion_reason}
                      disabled={toggleM.isPending}
                      onSave={(reason) =>
                        toggleM.mutate({
                          id: c.id,
                          isRelevantCompetitor: c.is_relevant_competitor ?? true,
                          exclusionReason: reason,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {c.last_reviewed_at
                      ? new Date(c.last_reviewed_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted truncate max-w-[120px]">
                    {c.last_reviewed_by
                      ? c.last_reviewed_by.split("_").slice(-1)[0] ?? c.last_reviewed_by
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SeoShell>
  );
}

/* ------------------------------------------------------------------ *
 * Export — brand + admin/lead gated
 * ------------------------------------------------------------------ */
export default function CompetitorCuration() {
  const { loading, activeBrand, accessible, isAdmin, role } = useActiveBrand();

  if (loading) return <SeoShell title="Competitor Curation" subtitle="Loading…" />;

  if (!isAdmin && role !== "lead") {
    return (
      <SeoShell title="Competitor Curation" subtitle="Access restricted">
        <StateBox>
          This page requires Admin or Lead role. Contact your account administrator.
        </StateBox>
      </SeoShell>
    );
  }

  if (!activeBrand) {
    return (
      <SeoShell title="Competitor Curation" subtitle="No brand selected">
        <StateBox>
          {accessible.length === 0
            ? "You don't have access to any brands yet. Ask an admin to grant brand access."
            : "Select a brand from the sidebar to continue."}
        </StateBox>
      </SeoShell>
    );
  }

  return <CompetitorCurationInner brandId={activeBrand.id} />;
}
