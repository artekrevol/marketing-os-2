import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export interface AuthBrand {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  voice_profile: Record<string, unknown>;
  thresholds: Record<string, unknown>;
}

export interface AuthUser {
  id: string;
  email: string | null;
  isAdmin: boolean;
  role: string;
  brands: AuthBrand[];
}

interface AuthContextType {
  user: AuthUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoaded: false,
  isSignedIn: false,
  signOut: async () => {},
  reload: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as {
          userId: string;
          email: string | null;
          isAdmin: boolean;
          role: string;
          brands: AuthBrand[];
        };
        setUser({
          id: data.userId,
          email: data.email,
          isAdmin: data.isAdmin,
          role: data.role,
          brands: data.brands,
        });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
    }
    setUser(null);
    window.location.href = "/seo-os/auth";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoaded,
        isSignedIn: !!user,
        signOut,
        reload: load,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
