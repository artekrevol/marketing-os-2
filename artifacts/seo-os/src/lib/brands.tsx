import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";

export type Brand = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
};

type Ctx = {
  loading: boolean;
  accessible: Brand[];
  activeBrand: Brand | null;
  setActiveBrand: (b: Brand) => void;
  isAdmin: boolean;
};

const BrandCtx = createContext<Ctx>({
  loading: true,
  accessible: [],
  activeBrand: null,
  setActiveBrand: () => {},
  isAdmin: false,
});

const STORAGE_KEY = "seo-os.activeBrandSlug";

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
  const [accessibleIds, setAccessibleIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setBrands([]);
      setAccessibleIds([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const [{ data: bs }, { data: prof }] = await Promise.all([
        supabase.from("brands").select("id,slug,name,primary_domain").order("name"),
        supabase
          .from("user_profiles")
          .select("brand_access")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const allBrands: Brand[] = ((bs ?? []) as Brand[]).map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        primary_domain: b.primary_domain ?? null,
      }));
      setBrands(allBrands);
      const access: string[] = (prof?.brand_access as string[] | undefined) ?? [];
      const visibleIds = isAdmin ? allBrands.map((b) => b.id) : access;
      setAccessibleIds(visibleIds);

      let nextActive: string | null = null;
      try {
        const slug = localStorage.getItem(STORAGE_KEY);
        if (slug) {
          const m = allBrands.find((b) => b.slug === slug && visibleIds.includes(b.id));
          if (m) nextActive = m.id;
        }
      } catch {}
      if (!nextActive) {
        const tek = allBrands.find((b) => b.slug === "tekrevol" && visibleIds.includes(b.id));
        if (tek) nextActive = tek.id;
      }
      if (!nextActive && visibleIds.length > 0) nextActive = visibleIds[0]!;
      setActiveId(nextActive);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isAdmin]);

  const accessible = useMemo(
    () => brands.filter((b) => accessibleIds.includes(b.id)),
    [brands, accessibleIds],
  );
  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeId) ?? null,
    [brands, activeId],
  );

  const setActiveBrand = useCallback((b: Brand) => {
    setActiveId(b.id);
    try {
      localStorage.setItem(STORAGE_KEY, b.slug);
    } catch {}
  }, []);

  const value = useMemo<Ctx>(
    () => ({ loading, accessible, activeBrand, setActiveBrand, isAdmin }),
    [loading, accessible, activeBrand, setActiveBrand, isAdmin],
  );

  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useActiveBrand() {
  return useContext(BrandCtx);
}
