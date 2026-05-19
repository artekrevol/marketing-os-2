import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Brand = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
};

type MeResponse = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  role: string;
  brands: Brand[];
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setBrands([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/me", { credentials: "include" })
      .then((r) => r.json() as Promise<MeResponse>)
      .then((data) => {
        if (cancelled) return;
        const allBrands = data.brands;
        setBrands(allBrands);

        let nextActive: string | null = null;
        try {
          const slug = localStorage.getItem(STORAGE_KEY);
          if (slug) {
            const m = allBrands.find((b) => b.slug === slug);
            if (m) nextActive = m.id;
          }
        } catch {}
        if (!nextActive) {
          const tek = allBrands.find((b) => b.slug === "tekrevol");
          if (tek) nextActive = tek.id;
        }
        if (!nextActive && allBrands.length > 0) nextActive = allBrands[0]!.id;
        setActiveId(nextActive);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isAdmin]);

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
    () => ({ loading, accessible: brands, activeBrand, setActiveBrand, isAdmin }),
    [loading, brands, activeBrand, setActiveBrand, isAdmin],
  );

  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useActiveBrand() {
  return useContext(BrandCtx);
}
