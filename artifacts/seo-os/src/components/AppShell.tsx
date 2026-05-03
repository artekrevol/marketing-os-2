import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ShieldCheck, Building2, ChevronDown, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { BrandProvider, useActiveBrand } from "@/lib/brands";

type AuthState = "loading" | "in" | "out" | "blocked" | "writer";

/**
 * Roles allowed to enter SEO OS. Sprint 3 locked scope: only writers
 * are blocked. Admin / lead / reviewer / outreach all need access —
 * leads triage queue health, reviewers decide, outreach uses the
 * approved-content list downstream. The /decide endpoint still gates
 * the actual approve/reject mutation to admin or reviewer roles
 * server-side, so giving leads/outreach read access here is safe.
 */
const SEO_OS_ROLES = new Set(["admin", "lead", "reviewer", "outreach"]);

/**
 * Auth shell. Mirrors the ContentForge auth-lock pattern: never await
 * inside onAuthStateChange — defer DB lookups with setTimeout(..., 0)
 * so the Supabase NavigatorLock does not deadlock during PKCE token
 * refresh.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loc, setLoc] = useLocation();

  useEffect(() => {
    let cancelled = false;

    const handleSession = (session: { user?: { id: string; email?: string } } | null) => {
      if (cancelled) return;
      if (!session) {
        setEmail(null);
        setUserId(null);
        setIsAdmin(false);
        setAuthState("out");
        return;
      }
      const e = (session.user?.email || "").toLowerCase();
      setEmail(e);
      setUserId(session.user!.id);

      // SEO OS is reviewer-or-admin only. We must not flip the user
      // "in" before the role lookup resolves — that would briefly
      // expose the review surface to writers.
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const [{ data: roles }, { data: profile }] = await Promise.all([
            supabase.from("user_roles").select("role").eq("user_id", session.user!.id),
            supabase
              .from("user_profiles")
              .select("brand_access,role")
              .eq("user_id", session.user!.id)
              .maybeSingle(),
          ]);
          if (cancelled) return;
          const profileRole = (profile as { role?: string } | null)?.role ?? null;
          const admin =
            !!(roles ?? []).find((r: { role: string }) => r.role === "admin") ||
            profileRole === "admin";
          setIsAdmin(!!admin);
          const access: string[] =
            ((profile as { brand_access?: string[] } | null)?.brand_access) ?? [];

          if (admin || (profileRole && SEO_OS_ROLES.has(profileRole))) {
            setAuthState("in");
          } else if (access.length > 0 || profileRole) {
            // User exists in the system but isn't a reviewer/admin —
            // surface the writer-facing message instead of a generic
            // "no brand access" block.
            setAuthState("writer");
          } else {
            setAuthState("blocked");
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[AppShell] role/profile lookup failed:", err);
          if (cancelled) return;
          setAuthState("blocked");
        }
      }, 0);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) =>
      handleSession(session as never),
    );
    supabase.auth.getSession().then(({ data }) => handleSession(data.session as never));

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
    if (authState === "out" && loc !== "/auth") setLoc("/auth");
  }, [authState, loc, setLoc]);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    setLoc("/auth");
  };

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">
        Loading…
      </div>
    );
  }

  if (authState === "out") {
    // Auth page renders without the chrome.
    return <>{children}</>;
  }

  if (authState === "blocked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
        <div className="max-w-sm border border-rule rounded-md bg-background p-8 text-center">
          <h1 className="font-serif text-xl mb-2">Access denied</h1>
          <p className="text-sm text-ink-muted mb-1">
            <span className="font-mono">{email}</span> has no profile yet.
          </p>
          <p className="text-sm text-ink-muted mb-6">
            Ask an admin to set up your account in ContentForge → Users &amp; access.
          </p>
          <button
            onClick={signOut}
            className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (authState === "writer") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
        <div className="max-w-md border border-rule rounded-md bg-background p-8 text-center">
          <h1 className="font-serif text-xl mb-2">SEO OS is for reviewers</h1>
          <p className="text-sm text-ink-muted mb-1">
            <span className="font-mono">{email}</span> isn’t a reviewer or admin.
          </p>
          <p className="text-sm text-ink-muted mb-6">
            Writers stay in ContentForge — submitted drafts surface there with
            their QA status. Ask an admin if you need the reviewer role.
          </p>
          <div className="flex items-center justify-center gap-2">
            <a
              href="/insight-forge"
              className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
            >
              Open ContentForge
            </a>
            <button
              onClick={signOut}
              className="border border-rule px-4 py-2 rounded-sm text-sm font-medium hover:bg-secondary"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BrandProvider userId={userId} isAdmin={isAdmin}>
      <div className="min-h-screen flex w-full bg-paper text-ink">
        <aside className="w-64 shrink-0 border-r border-rule bg-background flex flex-col">
          <div className="px-5 py-5 border-b border-rule">
            <Link href="/quality-gate" className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.75} />
              <span className="font-serif text-xl tracking-tight">SEO OS</span>
            </Link>
            <p className="text-[11px] uppercase tracking-widest text-ink-muted mt-1">
              Quality Gate
            </p>
          </div>

          <BrandSwitcher />

          <nav className="px-3 py-3 space-y-1 flex-1">
            <NavItem href="/quality-gate" label="Review queue" />
          </nav>

          <div className="px-3 py-3 border-t border-rule">
            <div className="px-2 pb-2 text-[10px] text-ink-muted truncate">
              {email}
              {isAdmin && <span className="ml-1 text-accent">· admin</span>}
            </div>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm hover:bg-secondary transition-colors"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </BrandProvider>
  );
}

function NavItem({ href, label }: { href: string; label: string }) {
  const [loc] = useLocation();
  const active = loc === href || loc.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`block px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
        active ? "bg-ink text-paper" : "hover:bg-secondary"
      }`}
    >
      {label}
    </Link>
  );
}

function BrandSwitcher() {
  const { loading, accessible, activeBrand, setActiveBrand } = useActiveBrand();
  const [open, setOpen] = useState(false);

  if (loading || accessible.length === 0) return null;

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
          <span className="truncate font-medium">{activeBrand?.name ?? "Select brand"}</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
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
