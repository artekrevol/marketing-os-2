import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

function KeywordListsInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["seo", "keyword-lists", brandId],
    queryFn: () => seo.listKeywordLists(brandId),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["seo", "keyword-lists", brandId] });

  const createM = useMutation({
    mutationFn: () =>
      seo.createKeywordList({
        brandId,
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      toast.success("List created");
      setName("");
      setDescription("");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => seo.deleteKeywordList(brandId, id),
    onSuccess: () => {
      toast.success("List deleted");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQ.data ?? [];

  return (
    <SeoShell title="Keyword Lists" subtitle="Group keywords for targeted crawls and schedules">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createM.mutate();
        }}
        className="border border-rule rounded-md bg-background p-4 mb-6 flex flex-col sm:flex-row gap-3 sm:items-end"
      >
        <label className="block flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Brand terms"
            className="input"
          />
        </label>
        <label className="block flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Description
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="input"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || createM.isPending}
          className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {createM.isPending ? "Creating…" : "Create list"}
        </button>
      </form>

      {listQ.isLoading ? (
        <StateBox>Loading lists…</StateBox>
      ) : rows.length === 0 ? (
        <StateBox>No keyword lists yet.</StateBox>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((l) => (
            <div
              key={l.id}
              className="border border-rule rounded-md bg-background p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{l.name}</div>
                {l.description && (
                  <div className="text-xs text-ink-muted mt-1">{l.description}</div>
                )}
              </div>
              <button
                onClick={() => deleteM.mutate(l.id)}
                className="text-ink-muted hover:text-red-600 shrink-0"
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </SeoShell>
  );
}

export default withBrand("Keyword Lists", undefined, (brandId) => (
  <KeywordListsInner brandId={brandId} />
));
