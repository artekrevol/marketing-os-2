import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Add them to artifacts/seo-os/.env (mirror artifacts/insight-forge/.env) " +
      "and restart the dev server.",
  );
}

// When the app is embedded inside the Replit preview iframe, direct
// localStorage access throws a SecurityError. This adapter tries localStorage
// first and silently falls back to an in-memory map so the app doesn't crash.
function makeSafeStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    window.localStorage.getItem("__probe__");
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
      removeItem: (key: string) => { mem.delete(key); },
    };
  }
}

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL ?? "http://invalid.local",
  SUPABASE_PUBLISHABLE_KEY ?? "missing",
  {
    auth: {
      storage: makeSafeStorage(),
      persistSession: true,
      autoRefreshToken: true,
      // Same storage key as ContentForge so a user signed in there is also
      // signed in here without re-authenticating (same Supabase project).
      storageKey: "sb-tekrevol-auth-token",
    },
  },
);
