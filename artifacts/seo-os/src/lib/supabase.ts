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

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL ?? "http://invalid.local",
  SUPABASE_PUBLISHABLE_KEY ?? "missing",
  {
    auth: {
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      // Same storage key as ContentForge so a user signed in there is also
      // signed in here without re-authenticating (same Supabase project).
      storageKey: "sb-tekrevol-auth-token",
    },
  },
);
