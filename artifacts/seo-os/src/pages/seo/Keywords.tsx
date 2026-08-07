import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { seo, crossModule } from "@/lib/api";
import { DataSourceTag } from "@workspace/ui-shared";
import { SeoShell, withBrand, StateBox } from "./_shell";

function KeywordsInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [listFilter, setListFilter] = useState<string>("");

  const listsQ = useQuery({
    queryKey: ["seo", "keyword-lists", brandId],
    queryFn: () => seo.listKeywordLists(brandId),
  });
  const locationsQ = useQuery({
    queryKey: ["seo", "locations", brandId],
    queryFn: () => seo.listLocations(brandId),
  });
  const keywordsQ = useQuery({
    queryKey: ["seo", "keywords", brandId, listFilter || null],
    queryFn: () => seo.listKeywords(brandId, listFilter || undefined),
  });

  const lists = listsQ.data ?? [];
  const locations = locationsQ.data ?? [];
  const keywords = keywordsQ.data ?? [];

  const [text, setText] = useState("");
  const [locationId, setLocationId] = useState("");
  const [listId, setListId] = useState("");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["seo", "keywords", brandId] });

  const createM = useMutation({
    mutationFn: () =>
      seo.createKeyword({
        brandId,
        keywordText: text.trim(),
        locationId,
        listId: listId || null,
      }),
    onSuccess: () => {
      toast.success("Keyword added");
      setText("");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => seo.deleteKeyword(brandId, id),
    onSuccess: () => {
      toast.success("Keyword removed");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "—";
  const canCreate = text.trim().length > 0 && locationId !== "";

  return (
    <SeoShell
      title="Keywords"
      subtitle="Terms tracked across your target locations"
      actions={
        <select
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value)}
          className="input !py-1.5 text-sm"
        >
          <option value="">All lists</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) createM.mutate();
        }}
        className="border border-rule rounded-md bg-background p-4 mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
      >
        <label className="block sm:col-span-2">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Keyword
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="mobile app development"
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Location
          </span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="input"
          >
            <option value="">Select…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            List (optional)
          </span>
          <select value={listId} onChange={(e) => setListId(e.target.value)} className="input">
            <option value="">None</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canCreate || createM.isPending}
          className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50 sm:col-span-1"
        >
          {createM.isPending ? "Adding…" : "Add keyword"}
        </button>
      </form>

      {locations.length === 0 && (
        <StateBox>
          Add a location first — keywords are tracked per location.
        </StateBox>
      )}

      {keywordsQ.isLoading ? (
        <StateBox>Loading keywords…</StateBox>
      ) : keywords.length === 0 ? (
        <StateBox>No keywords in this view.</StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-hidden mt-4">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Keyword</th>
                <th className="text-left font-medium px-4 py-2">Location</th>
                <th className="text-left font-medium px-4 py-2">Volume</th>
                <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Intent</th>
                <th className="text-right font-medium px-4 py-2 hidden md:table-cell">Ahrefs traffic</th>
                <th className="text-right font-medium px-4 py-2 hidden lg:table-cell">KD</th>
                <th className="text-left font-medium px-4 py-2">Linked content</th>
                <th className="px-4 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((k) => {
                const flags = (k.ahrefsIntentFlags ?? {}) as Record<string, boolean>;
                const intentBadges: Array<{ label: string; color: string }> = [];
                if (flags["informational"]) intentBadges.push({ label: "I", color: "bg-blue-100 text-blue-700" });
                if (flags["commercial"]) intentBadges.push({ label: "C", color: "bg-purple-100 text-purple-700" });
                if (flags["transactional"]) intentBadges.push({ label: "T", color: "bg-green-100 text-green-700" });
                if (flags["branded"]) intentBadges.push({ label: "B", color: "bg-gray-100 text-gray-700" });
                return (
                <tr key={k.id} className="border-t border-rule">
                  <td className="px-4 py-2 font-medium">{k.keywordText}</td>
                  <td className="px-4 py-2">{locName(k.locationId)}</td>
                  <td className="px-4 py-2">{k.searchVolume ?? "—"}</td>
                  <td className="px-4 py-2 hidden md:table-cell">
                    {intentBadges.length > 0 ? (
                      <div className="flex gap-0.5">
                        {intentBadges.map((b) => (
                          <span key={b.label} className={`inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-medium ${b.color}`}>
                            {b.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs hidden md:table-cell">
                    {k.ahrefsSumTraffic != null ? k.ahrefsSumTraffic.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs hidden lg:table-cell">
                    {k.ahrefsKeywordDifficulty != null ? Number(k.ahrefsKeywordDifficulty).toFixed(0) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <LinkedContentCell
                      brandId={brandId}
                      keywordId={k.id}
                      count={k.linkedContentCount}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteM.mutate(k.id)}
                      className="text-ink-muted hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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

/**
 * Cross-module read: shows how many ContentForge articles target this keyword.
 * "—" when none. When >0 it opens a popover that lazily fetches the linked
 * articles (with a <DataSourceTag> attributing them to ContentForge).
 */
function LinkedContentCell({
  brandId,
  keywordId,
  count,
}: {
  brandId: string;
  keywordId: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);

  const linkedQ = useQuery({
    queryKey: ["cross-module", "content-for-keyword", brandId, keywordId],
    queryFn: () => crossModule.contentForKeyword(brandId, keywordId),
    enabled: open && count > 0,
  });

  if (count <= 0) {
    return <span className="text-ink-muted">—</span>;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-sm hover:text-accent transition-colors"
        title="View linked articles"
      >
        <FileText className="h-3.5 w-3.5 text-ink-muted" />
        <span className="font-medium">{count}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-background border border-rule rounded-md shadow-md z-50 p-3">
          {linkedQ.isLoading ? (
            <p className="text-xs text-ink-muted">Loading linked articles…</p>
          ) : linkedQ.isError || (linkedQ.data && linkedQ.data.reason === "system-error") ? (
            // Rule 1/3: the fetch itself failed (network/throw) OR the helper
            // reported a system error. Either way this is NOT "no content" —
            // say so explicitly, tag the (failed) source, and offer a retry.
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-ink-muted">Couldn’t load linked content.</span>
                <DataSourceTag
                  source={linkedQ.data?.source ?? null}
                  reason={linkedQ.data?.reason ?? "system-error"}
                />
              </div>
              <button
                onClick={() => void linkedQ.refetch()}
                className="text-xs text-accent hover:underline"
              >
                retry
              </button>
            </div>
          ) : linkedQ.data && linkedQ.data.data.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                  Linked content
                </span>
                <DataSourceTag source={linkedQ.data.source} reason={linkedQ.data.reason} />
              </div>
              <ul className="space-y-1.5">
                {linkedQ.data.data.map((item) => (
                  <li key={item.projectId} className="flex items-start gap-2">
                    <FileText className="h-3.5 w-3.5 text-ink-muted mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {item.title}
                        {item.isCanonical && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent">
                            target
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-ink-muted">
                        {item.status}
                        {item.publishedUrl && (
                          <>
                            {" · "}
                            <a
                              href={item.publishedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 hover:text-accent"
                            >
                              live <ExternalLink className="h-3 w-3" />
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">No linked content.</span>
              {linkedQ.data && (
                <DataSourceTag source={linkedQ.data.source} reason={linkedQ.data.reason} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default withBrand("Keywords", undefined, (brandId) => (
  <KeywordsInner brandId={brandId} />
));
