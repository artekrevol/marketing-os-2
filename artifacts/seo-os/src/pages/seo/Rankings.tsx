import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

function RankingsInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();

  const rankingsQ = useQuery({
    queryKey: ["seo", "rankings", "current", brandId],
    queryFn: () => seo.currentRankings(brandId),
    staleTime: 30_000,
  });
  const batchesQ = useQuery({
    queryKey: ["seo", "crawls", "status", brandId],
    queryFn: () => seo.crawlStatus(brandId),
    refetchInterval: 5_000,
  });

  const crawlM = useMutation({
    mutationFn: () => seo.createCrawl({ brandId }),
    onSuccess: (r) => {
      toast.success(`Crawl queued — ${r.keywordCount} keyword(s)`);
      void qc.invalidateQueries({ queryKey: ["seo", "crawls", "status", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rankings = rankingsQ.data ?? [];
  const batches = batchesQ.data ?? [];
  const running = batches.find((b) => b.status === "pending" || b.status === "running");

  return (
    <SeoShell
      title="Rankings"
      subtitle="Latest SERP position per tracked keyword"
      actions={
        <button
          onClick={() => crawlM.mutate()}
          disabled={crawlM.isPending || !!running}
          className="flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          {running ? "Crawl running…" : crawlM.isPending ? "Queuing…" : "Run crawl"}
        </button>
      }
    >
      {batches.length > 0 && (
        <div className="border border-rule rounded-md bg-background p-4 mb-6">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted mb-2">
            Recent crawls
          </div>
          <div className="space-y-1">
            {batches.slice(0, 5).map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-ink-muted">
                  {new Date(b.createdAt).toLocaleString()}
                </span>
                <span>
                  {b.completedCount}/{b.keywordCount} keywords
                </span>
                <StatusPill status={b.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {rankingsQ.isLoading ? (
        <StateBox>Loading rankings…</StateBox>
      ) : rankings.length === 0 ? (
        <StateBox>
          No rankings yet. Add keywords, then run a crawl to capture SERP positions.
        </StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Keyword</th>
                <th className="text-left font-medium px-4 py-2">Position</th>
                <th className="text-left font-medium px-4 py-2">URL</th>
                <th className="text-left font-medium px-4 py-2">Captured</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr key={r.keyword_id} className="border-t border-rule">
                  <td className="px-4 py-2 font-medium">{r.keyword_text}</td>
                  <td className="px-4 py-2">
                    {r.found_at_position && r.position != null ? (
                      <span className="font-mono">{r.position}</span>
                    ) : (
                      <span className="text-ink-muted">not ranked</span>
                    )}
                  </td>
                  <td className="px-4 py-2 max-w-xs truncate">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline"
                      >
                        {r.url}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted">
                    {new Date(r.captured_at).toLocaleDateString()}
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

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "complete"
      ? "bg-green-100 text-green-800"
      : status === "failed"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${tone}`}>
      {status}
    </span>
  );
}

export default withBrand("Rankings", undefined, (brandId) => (
  <RankingsInner brandId={brandId} />
));
