import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Brand = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  voice_profile: Record<string, unknown>;
  thresholds: Record<string, unknown>;
};

type MeResponse = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  role: string;
  department: string;
  brands: Array<{
    id: string;
    slug: string;
    name: string;
    primaryDomain: string | null;
    voiceProfile: Record<string, unknown> | null;
    thresholds: Record<string, unknown> | null;
  }>;
};

type Ctx = {
  loading: boolean;
  brands: Brand[];
  accessible: Brand[];
  activeBrand: Brand | null;
  setActiveBrand: (b: Brand) => void;
  isAdmin: boolean;
  refresh: () => Promise<void>;
};

const BrandCtx = createContext<Ctx>({
  loading: true,
  brands: [],
  accessible: [],
  activeBrand: null,
  setActiveBrand: () => {},
  isAdmin: false,
  refresh: async () => {},
});

const STORAGE_KEY = "contentforge.activeBrandSlug";

export function BrandProvider({
  children,
  userId,
  isAdmin,
}: {
  children: ReactNode;
  userId: string | null;
  isAdmin: boolean;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setBrands([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/me", { credentials: "include" });
      if (!r.ok) throw new Error(`/api/me ${r.status}`);
      const data = (await r.json()) as MeResponse;
      const allBrands: Brand[] = data.brands.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        primary_domain: b.primaryDomain ?? null,
        voice_profile: b.voiceProfile || {},
        thresholds: b.thresholds || {},
      }));
      setBrands(allBrands);

      // Pick active brand:
      //   1) last-used slug from localStorage (per-device sticky);
      //   2) TekRevol — preserves the legacy single-tenant default;
      //   3) first accessible brand by load order.
      let nextActive: string | null = null;
      try {
        const slug = localStorage.getItem(STORAGE_KEY);
        if (slug) {
          const match = allBrands.find((b) => b.slug === slug);
          if (match) nextActive = match.id;
        }
      } catch {}
      if (!nextActive) {
        const tek = allBrands.find((b) => b.slug === "tekrevol");
        if (tek) nextActive = tek.id;
      }
      if (!nextActive && allBrands.length > 0) nextActive = allBrands[0]!.id;
      setActiveId(nextActive);
    } catch (e) {
      console.warn("[brands] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeId) || null,
    [brands, activeId],
  );

  const setActiveBrand = useCallback((b: Brand) => {
    setActiveId(b.id);
    try {
      localStorage.setItem(STORAGE_KEY, b.slug);
    } catch {}
  }, []);

  const value = useMemo<Ctx>(
    () => ({ loading, brands, accessible: brands, activeBrand, setActiveBrand, isAdmin, refresh: load }),
    [loading, brands, activeBrand, setActiveBrand, isAdmin, load],
  );

  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useActiveBrand() {
  return useContext(BrandCtx);
}
