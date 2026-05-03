import { useEffect, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tracks how long the signed-in user spends on each route, plus best-effort
 * project_id. One row per page-view is upserted-on-leave so the duration is
 * accurate. On hard unload we fall back to sendBeacon via fetch keepalive.
 */
export function usePageTracker() {
  const loc = useLocation();
  const params = useParams();
  const startRef = useRef<number>(Date.now());
  const userRef = useRef<{ id: string; email: string | null } | null>(null);
  const pathRef = useRef<string>(loc.pathname);
  const projectRef = useRef<string | null>((params as any).id || null);
  const enteredAtRef = useRef<string>(new Date().toISOString());

  // Resolve user once
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) userRef.current = { id: data.user.id, email: data.user.email ?? null };
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) userRef.current = { id: session.user.id, email: session.user.email ?? null };
      else userRef.current = null;
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const flush = (reason: "navigate" | "unload") => {
    const u = userRef.current;
    if (!u) return;
    const duration_ms = Date.now() - startRef.current;
    if (duration_ms < 500) return; // ignore flicker navigations
    const row = {
      user_id: u.id,
      user_email: u.email,
      path: pathRef.current,
      project_id: projectRef.current,
      entered_at: enteredAtRef.current,
      duration_ms,
      user_agent: navigator.userAgent,
      referrer: document.referrer || null,
    };
    if (reason === "unload") {
      // Best-effort beacon — bypasses the supabase-js auth lock during pagehide.
      try {
        const url = `${(import.meta as any).env.VITE_SUPABASE_URL}/rest/v1/page_events`;
        const apikey = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY;
        supabase.auth.getSession().then(({ data }) => {
          const token = data.session?.access_token || apikey;
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey,
              Authorization: `Bearer ${token}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify(row),
            keepalive: true,
          }).catch(() => {});
        });
      } catch {
        /* ignore */
      }
    } else {
      supabase.from("page_events").insert(row).then(({ error }) => {
        if (error) console.warn("[page_events] insert failed:", error.message);
      });
    }
  };

  // On route change: flush previous, reset for new
  useEffect(() => {
    const newPath = loc.pathname;
    const newProject = (params as any).id || null;
    if (newPath !== pathRef.current) {
      flush("navigate");
      pathRef.current = newPath;
      projectRef.current = newProject;
      startRef.current = Date.now();
      enteredAtRef.current = new Date().toISOString();
    } else if (newProject !== projectRef.current) {
      projectRef.current = newProject;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, (params as any).id]);

  // Flush on tab close / hide
  useEffect(() => {
    const onHide = () => flush("unload");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush("unload");
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}