import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

function CompetitorsInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();

  const pagesQ = useQuery({
    queryKey: ["seo", "competitor-pages", brandId],
    queryFn: () => seo.listCompetitorPages(brandId),
    staleTime: 30_000,
  });

  const discoverM = useMutation({
    mutationFn: () => seo.discoverCompetitors({ brandId }),
    onSuccess: () => {
      toast.success("Competitor discovery queued");
      void qc.invalidateQueries({ queryKey: ["seo", "competitor-pages", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pages = pagesQ.data ?? [];

  return (
    <SeoShell
      title="Competitors"
      subtitle="Competing pages discovered from your tracked keywords' SERPs"
      actions={
        <button
          onClick={() => discoverM.mutate()}
          disabled={discoverM.isPending}
          className="flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          {discoverM.isPending ? "Queuing…" : "Discover competitors"}
        </button>
      }
    >
      {pagesQ.isLoading ? (
        <StateBox>Loading competitor pages…</StateBox>
      ) : pages.length === 0 ? (
        <StateBox>
          No competitor pages yet. Run discovery to scan your keywords' SERPs for
          competing domains (this triggers DataForSEO lookups).
        </StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Domain</th>
                <th className="text-left font-medium px-4 py-2">Position</th>
                <th className="text-left font-medium px-4 py-2">URL</th>
                <th className="text-left font-medium px-4 py-2">Captured</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id} className="border-t border-rule">
                  <td className="px-4 py-2 font-medium">{p.competitorDomain}</td>
                  <td className="px-4 py-2 font-mono">{p.position ?? "—"}</td>
                  <td className="px-4 py-2 max-w-xs truncate">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent underline"
                    >
                      {p.url}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted">
                    {new Date(p.capturedAt).toLocaleDateString()}
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

export default withBrand("Competitors", undefined, (brandId) => (
  <CompetitorsInner brandId={brandId} />
));
