// Replaces @lovable.dev/cloud-auth-js with native Supabase auth.
// The same interface shape is preserved so Auth.tsx requires no changes.

import type { Provider } from "@supabase/supabase-js";
import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

type SignInResult =
  | { redirected: true; error: null }
  | { redirected: false; error: Error };

// Lovable used "microsoft" but Supabase calls it "azure".
const PROVIDER_MAP: Record<string, Provider> = {
  google: "google",
  apple: "apple",
  microsoft: "azure",
  lovable: "google", // no-op fallback; "lovable" was Lovable-Cloud-only
};

export const lovable = {
  auth: {
    signInWithOAuth: async (
      provider: "google" | "apple" | "microsoft" | "lovable",
      opts?: SignInOptions,
    ): Promise<SignInResult> => {
      const supabaseProvider = PROVIDER_MAP[provider] ?? "google";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: supabaseProvider,
        options: {
          redirectTo: opts?.redirect_uri ?? window.location.origin,
          queryParams: opts?.extraParams,
          skipBrowserRedirect: false,
        },
      });

      if (error) {
        return { redirected: false, error };
      }

      // Supabase performs the redirect automatically; signal that so Auth.tsx
      // doesn't attempt a client-side nav().
      return { redirected: true, error: null };
    },
  },
};
