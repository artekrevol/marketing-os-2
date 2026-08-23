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
  department: string;
  brands: Brand[];
};

type Ctx = {
  loading: boolean;
  accessible: Brand[];
  activeBrand: Brand | null;
  setActiveBrand: (b: Brand) => void;
  refreshBrands: () => Promise<Brand[]>;
  isAdmin: boolean;
  /** Raw role string from /api/me: "admin" | "lead" | "reviewer" | "member" */
  role: string;
};

const BrandCtx = createContext<Ctx>({
  loading: true,
  accessible: [],
  activeBrand: null,
  setActiveBrand: () => {},
  refreshBrands: async () => [],
  isAdmin: false,
  role: "member",
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
  const [role, setRole] = useState<string>("member");

  const refreshBrands = useCallback(async (): Promise<Brand[]> => {
    if (!userId) {
      setBrands([]);
      setActiveId(null);
      setLoading(false);
      return [];
    }

    setLoading(true);
    try {
      const response = await fetch("/api/me", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load brands");
      const data = (await response.json()) as MeResponse;
      const allBrands = data.brands;
      setBrands(allBrands);
      setRole(data.role ?? "member");

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
      return allBrands;
    } catch {
      setBrands([]);
      setActiveId(null);
      return [];
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refreshBrands();
  }, [refreshBrands]);

  /*
   * Keep the selected brand in local storage so a newly created brand can be
   * selected immediately and remains selected after a page refresh.
   */
  const setActiveBrand = useCallback((b: Brand) => {
    setActiveId(b.id);
    try {
      localStorage.setItem(STORAGE_KEY, b.slug);
    } catch {}
  }, []);

  const activeBrand = useMemo(
    () => brands.find((b) => b.id === activeId) ?? null,
    [brands, activeId],
  );

  const value = useMemo<Ctx>(
    () => ({ loading, accessible: brands, activeBrand, setActiveBrand, refreshBrands, isAdmin, role }),
    [loading, brands, activeBrand, setActiveBrand, refreshBrands, isAdmin, role],
  );

  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useActiveBrand() {
  return useContext(BrandCtx);
}
