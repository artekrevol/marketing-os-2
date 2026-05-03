import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Brand = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  voice_profile: Record<string, unknown>;
  thresholds: Record<string, unknown>;
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
  const [accessibleIds, setAccessibleIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setBrands([]);
      setAccessibleIds([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: bs }, { data: prof }] = await Promise.all([
      (supabase as any).from("brands").select("*").order("name"),
      (supabase as any).from("user_profiles").select("brand_access").eq("user_id", userId).maybeSingle(),
    ]);
    const allBrands = ((bs as Brand[]) || []).map((b) => ({
      ...b,
      voice_profile: (b.voice_profile as any) || {},
      thresholds: (b.thresholds as any) || {},
    }));
    setBrands(allBrands);
    const access: string[] = (prof as any)?.brand_access || [];
    // Admins see every brand.
    const visibleIds = isAdmin ? allBrands.map((b) => b.id) : access;
    setAccessibleIds(visibleIds);

    // Pick active brand: localStorage slug → first accessible.
    let nextActive: string | null = null;
    try {
      const slug = localStorage.getItem(STORAGE_KEY);
      if (slug) {
        const match = allBrands.find((b) => b.slug === slug && visibleIds.includes(b.id));
        if (match) nextActive = match.id;
      }
    } catch {}
    if (!nextActive && visibleIds.length > 0) nextActive = visibleIds[0];
    setActiveId(nextActive);
    setLoading(false);
  }, [userId, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const accessible = useMemo(
    () => brands.filter((b) => accessibleIds.includes(b.id)),
    [brands, accessibleIds],
  );
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
    () => ({ loading, brands, accessible, activeBrand, setActiveBrand, isAdmin, refresh: load }),
    [loading, brands, accessible, activeBrand, setActiveBrand, isAdmin, load],
  );

  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useActiveBrand() {
  return useContext(BrandCtx);
}
