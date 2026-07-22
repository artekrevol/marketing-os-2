import { useCallback, useEffect, useRef, useState } from "react";

export type TagEntry = { tag: string; count: number };

const cache = new Map<string, TagEntry[]>();

export function useTagVocab(brandId: string | null) {
  const [vocab, setVocab] = useState<TagEntry[]>(() =>
    brandId ? (cache.get(brandId) ?? []) : [],
  );
  const [loading, setLoading] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  const refresh = useCallback(async (forBrandId: string) => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/tag-vocab?brandId=${forBrandId}`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { keyword: TagEntry[] };
      cache.set(forBrandId, data.keyword);
      setVocab(data.keyword);
    } catch {
      // non-fatal — autocomplete degrades to free-form input
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!brandId) return;
    if (fetchedFor.current === brandId) return;
    fetchedFor.current = brandId;
    if (cache.has(brandId)) {
      setVocab(cache.get(brandId)!);
      return;
    }
    void refresh(brandId);
  }, [brandId, refresh]);

  return { vocab, loading, refresh };
}

export function invalidateTagVocab(brandId: string) {
  cache.delete(brandId);
}
