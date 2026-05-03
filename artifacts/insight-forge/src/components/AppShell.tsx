import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, NotebookPen, LayoutGrid, LogOut, Shield, Activity, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Project } from "@/lib/types";
import { usePageTracker } from "@/lib/usePageTracker";

export default function AppShell() {
  usePageTracker();
  const [projects, setProjects] = useState<Project[]>([]);
  const [authState, setAuthState] = useState<"loading" | "in" | "out" | "blocked">("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;

    // Synchronous part — runs inside the auth callback. NEVER do async
    // supabase calls here or the auth-token NavigatorLock will deadlock
    // (LockAcquireTimeoutError: lock was released because another request stole it).
    const handleSession = (session: any) => {
      if (cancelled) return;
      if (!session) {
        setEmail(null);
        setIsAdmin(false);
        setAuthState("out");
        return;
      }
      const e = (session.user?.email || "").toLowerCase();
      setEmail(e);
      const isTek = e.endsWith("@tekrevol.com");
      // Optimistically allow tekrevol users in immediately so they're never
      // blocked on the admin role lookup. Non-tekrevol users wait for the
      // role check before we decide blocked vs in.
      if (isTek) setAuthState("in");

      // Defer the DB call so it doesn't run inside the auth lock.
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const { data: roles } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", session.user.id);
          if (cancelled) return;
          const admin = !!(roles || []).find((r: any) => r.role === "admin");
          setIsAdmin(admin);
          if (!isTek) setAuthState(admin ? "in" : "blocked");
        } catch (err) {
          console.warn("[AppShell] role lookup failed:", err);
          if (cancelled) return;
          if (!isTek) setAuthState("blocked");
        }
      }, 0);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => handleSession(session));
    supabase.auth.getSession().then(({ data }) => handleSession(data.session));

    // Hard safety net: never let the screen sit on "Loading…" forever.
    const safety = setTimeout(() => {
      if (cancelled) return;
      setAuthState((s) => (s === "loading" ? "out" : s));
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(safety);
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authState === "out" && loc.pathname !== "/auth") nav("/auth", { replace: true });
  }, [authState, loc.pathname, nav]);

  useEffect(() => {
    if (authState !== "in") return;
    let mounted = true;
    const load = async () => {
      const { data } = await supabase.from("projects").select("*").order("updated_at", { ascending: false }).limit(50);
      if (mounted) setProjects((data as any) || []);
    };
    load();
    const ch = supabase
      .channel("proj-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [authState]);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    nav("/auth", { replace: true });
  };

  if (authState === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">Loading…</div>;
  }
  if (authState === "out") {
    return <Outlet />;
  }
  if (authState === "blocked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
        <div className="max-w-sm border border-rule rounded-sm bg-background p-8 text-center">
          <h1 className="font-serif text-xl mb-2">Access denied</h1>
          <p className="text-sm text-ink-muted mb-1">
            <span className="font-mono">{email}</span> is not a tekrevol.com account.
          </p>
          <p className="text-sm text-ink-muted mb-6">Sign in with your @tekrevol.com Google account.</p>
          <button onClick={signOut} className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent">
            Sign out & try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex w-full bg-paper text-ink">
      <aside className="w-72 shrink-0 border-r border-rule bg-background flex flex-col">
        <div className="px-5 py-5 border-b border-rule">
          <Link to="/" className="flex items-center gap-2">
            <NotebookPen className="h-5 w-5 text-accent" strokeWidth={1.75} />
            <span className="font-serif text-xl tracking-tight">ContentForge</span>
          </Link>
          <p className="text-[11px] uppercase tracking-widest text-ink-muted mt-1">Research notebook</p>
        </div>

        <div className="px-3 py-3 space-y-1">
          <NavLink
            to="/new"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                isActive ? "bg-ink text-paper" : "hover:bg-secondary"
              }`
            }
          >
            <Plus className="h-4 w-4" /> New project
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                isActive ? "bg-ink text-paper" : "hover:bg-secondary"
              }`
            }
          >
            <LayoutGrid className="h-4 w-4" /> Admin dashboard
          </NavLink>
          {isAdmin && (
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                  isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                }`
              }
            >
              <Shield className="h-4 w-4" /> Users & access
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/activity"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                  isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                }`
              }
            >
              <Activity className="h-4 w-4" /> Activity log
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/usage"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                  isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                }`
              }
            >
              <DollarSign className="h-4 w-4" /> AI usage & cost
            </NavLink>
          )}
        </div>

        <div className="px-5 pt-4 pb-2 text-[10px] uppercase tracking-widest text-ink-muted">Projects</div>
        <nav className="flex-1 overflow-y-auto px-2 pb-6 space-y-px">
          {projects.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink-muted italic">No projects yet.</p>
          )}
          {projects.map((p) => (
            <NavLink
              key={p.id}
              to={`/project/${p.id}/${p.current_stage === 0 ? "brief" : p.current_stage === 1 ? "research" : p.current_stage === 2 ? "outline" : p.current_stage === 3 ? "draft" : "review"}`}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-sm text-sm transition-colors ${
                  isActive ? "bg-secondary" : "hover:bg-secondary/60"
                }`
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{p.topic}</span>
                <span className="text-[10px] font-mono text-ink-muted">S{p.current_stage}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mt-0.5">{p.status.replace(/_/g, " ")}</div>
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-rule">
          <div className="px-2 pb-2 text-[10px] text-ink-muted truncate">
            {email}{isAdmin && <span className="ml-1 text-accent">· admin</span>}
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm hover:bg-secondary transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}