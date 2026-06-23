import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

function CompetitorInsightsInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();

  const insightsQ = useQuery({
    queryKey: ["seo", "competitor-insights", brandId],
    queryFn: () => seo.listCompetitorInsights(brandId),
    staleTime: 30_000,
  });

  const computeM = useMutation({
    mutationFn: () => seo.computeCompetitorInsights(brandId),
    onSuccess: () => {
      toast.success("Recompute queued");
      void qc.invalidateQueries({ queryKey: ["seo", "competitor-insights", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const insights = insightsQ.data ?? [];

  return (
    <SeoShell
      title="Competitor Insights"
      subtitle="Aggregated overlap between your keywords and competitor domains"
      actions={
        <button
          onClick={() => computeM.mutate()}
          disabled={computeM.isPending}
          className="flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {computeM.isPending ? "Queuing…" : "Recompute"}
        </button>
      }
    >
      {insightsQ.isLoading ? (
        <StateBox>Loading insights…</StateBox>
      ) : insights.length === 0 ? (
        <StateBox>
          No insights yet. Discover competitors first, then recompute to aggregate
          shared-keyword overlap.
        </StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Competitor</th>
                <th className="text-left font-medium px-4 py-2">Shared keywords</th>
                <th className="text-left font-medium px-4 py-2">Avg position</th>
                <th className="text-left font-medium px-4 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {insights.map((i) => (
                <tr key={i.id} className="border-t border-rule">
                  <td className="px-4 py-2 font-medium">{i.competitorDomain}</td>
                  <td className="px-4 py-2 font-mono">{i.sharedKeywordCount}</td>
                  <td className="px-4 py-2 font-mono">
                    {i.averagePosition != null ? Number(i.averagePosition).toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted">
                    {i.lastComputedAt
                      ? new Date(i.lastComputedAt).toLocaleString()
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

export default withBrand("Competitor Insights", undefined, (brandId) => (
  <CompetitorInsightsInner brandId={brandId} />
));
