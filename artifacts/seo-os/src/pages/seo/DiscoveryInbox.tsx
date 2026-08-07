import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Square, ChevronUp, ChevronDown, Minus } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { useActiveBrand } from "@/lib/brands";
import { SeoShell, StateBox } from "./_shell";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */
type ReviewStatus = "pending" | "promoted" | "rejected" | "archived";

export interface DiscoveryCandidate {
  id: string;
  keyword_text: string;
  discovery_seed_keyword: string | null;
  candidate_review_status: ReviewStatus | null;
  candidate_reviewed_at: string | null;
  candidate_reviewed_by: string | null;
  discovered_at: string | null;
  search_volume: number | null;
  difficulty: string | null;
  ahrefs_keyword_difficulty: number | null;
  priority: string | null;
}

type FilterTab = "all" | ReviewStatus;

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "promoted", label: "Promoted" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];

const STATUS_COLORS: Record<string, string> = {
  pending:  "bg-amber-100 text-amber-800",
  promoted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  archived: "bg-zinc-100 text-zinc-600",
};

/* ------------------------------------------------------------------ *
 * Inner component (brand already resolved)
 * ------------------------------------------------------------------ */
function DiscoveryInboxInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState("");

  const candidatesQ = useQuery({
    queryKey: ["seo", "discovery-inbox", brandId, filter],
    queryFn: () => seo.listDiscoveryCandidates(brandId, filter === "all" ? undefined : filter),
    staleTime: 15_000,
  });

  const reviewM = useMutation({
    mutationFn: ({ keywordId, decision }: { keywordId: string; decision: string }) =>
      seo.reviewCandidate(brandId, keywordId, decision),
    onSuccess: (_, { decision }) => {
      toast.success(`Keyword ${decision}`);
      void qc.invalidateQueries({ queryKey: ["seo", "discovery-inbox", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkM = useMutation({
    mutationFn: ({ ids, decision }: { ids: string[]; decision: string }) =>
      seo.reviewCandidatesBulk(brandId, ids, decision),
    onSuccess: (data, { decision }) => {
      toast.success(`${data.updated} keywords ${decision}`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["seo", "discovery-inbox", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const candidates: DiscoveryCandidate[] = candidatesQ.data ?? [];

  const allIds = candidates.filter((c) => c.candidate_review_status === "pending").map((c) => c.id);
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

  const kd = (c: DiscoveryCandidate) =>
    c.ahrefs_keyword_difficulty ?? (c.difficulty != null ? Number(c.difficulty) : null);

  return (
    <SeoShell
      title="Discovery Inbox"
      subtitle="Review keyword candidates surfaced by the weekly discovery engine"
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
        {candidatesQ.data && (
          <span className="text-xs text-ink-muted ml-2">
            {candidates.length} {filter === "all" ? "total" : filter}
          </span>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-secondary/60 border border-rule rounded-md text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button
            onClick={() => bulkM.mutate({ ids: Array.from(selected), decision: "promoted" })}
            disabled={bulkM.isPending}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Promote all
          </button>
          <button
            onClick={() => bulkM.mutate({ ids: Array.from(selected), decision: "rejected" })}
            disabled={bulkM.isPending}
            className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
          >
            Reject all
          </button>
          <button
            onClick={() => bulkM.mutate({ ids: Array.from(selected), decision: "archived" })}
            disabled={bulkM.isPending}
            className="px-3 py-1 bg-zinc-500 text-white rounded text-xs font-medium hover:bg-zinc-600 disabled:opacity-50"
          >
            Archive all
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-ink-muted hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      {candidatesQ.isLoading ? (
        <StateBox>Loading candidates…</StateBox>
      ) : candidates.length === 0 ? (
        <StateBox>
          {filter === "pending"
            ? "No pending candidates — the discovery engine hasn't run yet or all candidates have been reviewed."
            : `No ${filter === "all" ? "" : filter + " "}candidates found.`}
        </StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 w-8">
                  {filter === "pending" || filter === "all" ? (
                    <button onClick={toggleAll} className="text-ink-muted hover:text-ink">
                      {allSelected ? (
                        <CheckSquare className="h-4 w-4" />
                      ) : someSelected ? (
                        <Minus className="h-4 w-4" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  ) : null}
                </th>
                <th className="text-left font-medium px-3 py-2">Keyword</th>
                <th className="text-left font-medium px-3 py-2">Source</th>
                <th className="text-right font-medium px-3 py-2">Volume</th>
                <th className="text-right font-medium px-3 py-2">KD</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Discovered</th>
                <th className="text-left font-medium px-3 py-2 w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const isPending = c.candidate_review_status === "pending";
                const kdVal = kd(c);
                return (
                  <tr
                    key={c.id}
                    className={`border-t border-rule hover:bg-secondary/20 ${
                      selected.has(c.id) ? "bg-secondary/40" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      {isPending && (
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
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium max-w-xs truncate">
                      {c.keyword_text}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted max-w-[180px] truncate">
                      {c.discovery_seed_keyword
                        ? c.discovery_seed_keyword.startsWith("competitor:")
                          ? <span className="font-mono bg-secondary/60 px-1 rounded">{c.discovery_seed_keyword}</span>
                          : c.discovery_seed_keyword
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-right text-xs">
                      {c.search_volume != null ? c.search_volume.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {kdVal != null ? (
                        <span
                          className={`inline-flex items-center gap-0.5 text-xs font-mono font-medium ${
                            kdVal >= 60
                              ? "text-red-600"
                              : kdVal >= 40
                                ? "text-amber-600"
                                : "text-green-600"
                          }`}
                        >
                          {kdVal >= 60 ? <ChevronUp className="h-3 w-3" /> :
                           kdVal < 30 ? <ChevronDown className="h-3 w-3" /> : null}
                          {kdVal}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[c.candidate_review_status ?? ""] ?? "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {c.candidate_review_status ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-muted">
                      {c.discovered_at ? new Date(c.discovered_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {isPending && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => reviewM.mutate({ keywordId: c.id, decision: "promoted" })}
                            disabled={reviewM.isPending}
                            title="Promote — add to tracked keyword set"
                            className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => reviewM.mutate({ keywordId: c.id, decision: "rejected" })}
                            disabled={reviewM.isPending}
                            title="Reject"
                            className="px-2 py-0.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 disabled:opacity-50"
                          >
                            ✗
                          </button>
                          <button
                            onClick={() => reviewM.mutate({ keywordId: c.id, decision: "archived" })}
                            disabled={reviewM.isPending}
                            title="Archive"
                            className="px-2 py-0.5 bg-zinc-400 text-white rounded text-xs font-medium hover:bg-zinc-500 disabled:opacity-50"
                          >
                            ⤓
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
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
export default function DiscoveryInbox() {
  const { loading, activeBrand, accessible, isAdmin, role } = useActiveBrand();

  if (loading) return <SeoShell title="Discovery Inbox" subtitle="Loading…" />;

  if (!isAdmin && role !== "lead") {
    return (
      <SeoShell title="Discovery Inbox" subtitle="Access restricted">
        <StateBox>
          This page requires Admin or Lead role. Contact your account administrator.
        </StateBox>
      </SeoShell>
    );
  }

  if (!activeBrand) {
    return (
      <SeoShell title="Discovery Inbox" subtitle="No brand selected">
        <StateBox>
          {accessible.length === 0
            ? "You don't have access to any brands yet. Ask an admin to grant brand access."
            : "Select a brand from the sidebar to continue."}
        </StateBox>
      </SeoShell>
    );
  }

  return <DiscoveryInboxInner brandId={activeBrand.id} />;
}
