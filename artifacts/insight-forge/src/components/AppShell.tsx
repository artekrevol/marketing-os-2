import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { Plus, NotebookPen, LayoutGrid, LogOut, Shield, Activity, DollarSign, Building2, ChevronDown, Server, LayoutDashboard, MessageSquareQuote, Link2, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { Project } from "@/lib/types";
import { usePageTracker } from "@/lib/usePageTracker";
import { BrandProvider, useActiveBrand } from "@/lib/brands";

export default function AppShell() {
  usePageTracker();
  const { user, isLoaded, isSignedIn, signOut: authSignOut } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  const isAdmin = user?.isAdmin ?? false;
  const email = user?.email ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (isLoaded && !isSignedIn && loc.pathname !== "/auth") {
      nav("/auth", { replace: true });
    }
  }, [isLoaded, isSignedIn, loc.pathname, nav]);

  const signOut = async () => {
    await authSignOut();
    toast.success("Signed out");
  };

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">Loading…</div>;
  }

  if (!isSignedIn) {
    return <Outlet />;
  }

  return (
    <BrandProvider userId={userId} isAdmin={isAdmin}>
      <div className="min-h-screen flex w-full bg-paper text-ink">
        <aside className="w-72 shrink-0 border-r border-rule bg-background flex flex-col">
          <div className="px-5 py-5 border-b border-rule">
            <Link to="/projects" className="flex items-center gap-2">
              <NotebookPen className="h-5 w-5 text-accent" strokeWidth={1.75} />
              <span className="font-serif text-xl tracking-tight">ContentForge</span>
            </Link>
            <p className="text-[11px] uppercase tracking-widest text-ink-muted mt-1">Research notebook</p>
          </div>

          <BrandSwitcher />

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
                to="/admin/brands"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                  }`
                }
              >
                <Building2 className="h-4 w-4" /> Brands
              </NavLink>
            )}
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
            {isAdmin && (
              <NavLink
                to="/admin/system"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                  }`
                }
              >
                <Server className="h-4 w-4" /> System
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/admin/reviews-bank"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                  }`
                }
              >
                <MessageSquareQuote className="h-4 w-4" /> Reviews bank
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/admin/link-targets"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                  }`
                }
              >
                <Link2 className="h-4 w-4" /> Link targets
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/admin/rules-dashboard"
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActive ? "bg-ink text-paper" : "hover:bg-secondary"
                  }`
                }
              >
                <Settings className="h-4 w-4" /> Rules dashboard
              </NavLink>
            )}
          </div>

          <ProjectList />

          <div className="px-3 py-3 border-t border-rule">
            <div className="px-2 pb-2 text-[10px] text-ink-muted truncate">
              {email}{isAdmin && <span className="ml-1 text-accent">· admin</span>}
            </div>
            <Link
              to="/"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm hover:bg-secondary transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" /> All modules
            </Link>
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
    </BrandProvider>
  );
}

function ProjectList() {
  const { activeBrand, loading: brandLoading } = useActiveBrand();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (brandLoading || !activeBrand) {
      setProjects([]);
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/projects?brandId=${activeBrand.id}`, { credentials: "include" });
        if (!r.ok) return;
        const data = (await r.json()) as Project[];
        if (mounted) setProjects(data);
      } catch {}
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeBrand, brandLoading]);

  return (
    <>
      <div className="px-5 pt-4 pb-2 text-[10px] uppercase tracking-widest text-ink-muted">Projects</div>
      <nav className="flex-1 overflow-y-auto px-2 pb-6 space-y-px">
        {projects.length === 0 && (
          <p className="px-3 py-2 text-xs text-ink-muted italic">
            {brandLoading ? "Loading…" : activeBrand ? `No projects in ${activeBrand.name} yet.` : "Select a brand to view projects."}
          </p>
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
    </>
  );
}

function BrandSwitcher() {
  const { loading, accessible, activeBrand, setActiveBrand } = useActiveBrand();
  const [open, setOpen] = useState(false);

  if (loading || accessible.length === 0) {
    return null;
  }

  if (accessible.length === 1) {
    return (
      <div className="px-5 py-3 border-b border-rule flex items-center gap-2">
        <Building2 className="h-3.5 w-3.5 text-ink-muted" />
        <span className="text-xs font-medium">{accessible[0]!.name}</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-b border-rule relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className="h-3.5 w-3.5 text-ink-muted shrink-0" />
          <span className="truncate font-medium">{activeBrand?.name || "Select brand"}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-3 right-3 mt-1 bg-background border border-rule rounded-sm shadow-md z-50 max-h-64 overflow-y-auto">
          {accessible.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setActiveBrand(b);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary ${
                activeBrand?.id === b.id ? "bg-secondary/60 font-medium" : ""
              }`}
            >
              {b.name}
              <span className="ml-2 text-[10px] font-mono text-ink-muted">{b.slug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
