import { useEffect, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useUser } from "@clerk/react";

/**
 * Tracks how long the signed-in user spends on each route, plus best-effort
 * project_id. One row per page-view is posted on leave.
 */
export function usePageTracker() {
  const loc = useLocation();
  const params = useParams();
  const { user } = useUser();
  const startRef = useRef<number>(Date.now());
  const pathRef = useRef<string>(loc.pathname);
  const projectRef = useRef<string | null>((params as any).id || null);
  const enteredAtRef = useRef<string>(new Date().toISOString());
  const userRef = useRef<{ id: string; email: string | null } | null>(null);

  useEffect(() => {
    if (user) {
      userRef.current = { id: user.id, email: user.primaryEmailAddress?.emailAddress ?? null };
    } else {
      userRef.current = null;
    }
  }, [user]);

  const flush = (reason: "navigate" | "unload") => {
    const u = userRef.current;
    if (!u) return;
    const duration_ms = Date.now() - startRef.current;
    if (duration_ms < 500) return;
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
    try {
      fetch("/api/page-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(row),
        keepalive: reason === "unload",
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  };

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
