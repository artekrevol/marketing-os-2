import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
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
                <th className="px-4 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((k) => (
                <tr key={k.id} className="border-t border-rule">
                  <td className="px-4 py-2 font-medium">{k.keywordText}</td>
                  <td className="px-4 py-2">{locName(k.locationId)}</td>
                  <td className="px-4 py-2">{k.searchVolume ?? "—"}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SeoShell>
  );
}

export default withBrand("Keywords", undefined, (brandId) => (
  <KeywordsInner brandId={brandId} />
));
