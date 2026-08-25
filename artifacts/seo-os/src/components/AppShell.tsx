import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ShieldCheck, Building2, ChevronDown, LogOut, LayoutDashboard, Plus, X, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";
import { BrandProvider, useActiveBrand, type Brand } from "@/lib/brands";

type AuthState = "loading" | "in" | "out" | "blocked" | "member";

const SEO_OS_ROLES = new Set(["admin", "lead", "reviewer"]);

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, isLoaded, isSignedIn, signOut: authSignOut } = useAuth();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [loc, setLoc] = useLocation();

  const email = user?.email ?? null;
  const userId = user?.id ?? null;
  const isAdmin = user?.isAdmin ?? false;

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setAuthState("out");
      return;
    }
    const role = user!.role;
    if (user!.isAdmin || SEO_OS_ROLES.has(role)) {
      setAuthState("in");
    } else if (role === "member") {
      setAuthState("member");
    } else {
      setAuthState("blocked");
    }
  }, [isLoaded, isSignedIn, user]);

  useEffect(() => {
    if (authState === "out" && loc !== "/auth") setLoc("/auth");
  }, [authState, loc, setLoc]);

  const signOut = async () => {
    await authSignOut();
    toast.success("Signed out");
  };

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">
        Loading…
      </div>
    );
  }

  if (authState === "out") {
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

  if (authState === "member") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
        <div className="max-w-md border border-rule rounded-md bg-background p-8 text-center">
          <h1 className="font-serif text-xl mb-2">SEO OS is for reviewers</h1>
          <p className="text-sm text-ink-muted mb-1">
            <span className="font-mono">{email}</span> isn't a reviewer or admin.
          </p>
          <p className="text-sm text-ink-muted mb-6">
            Members stay in ContentForge — submitted drafts surface there with
            their QA status. Ask an admin if you need the reviewer role.
          </p>
          <div className="flex items-center justify-center gap-2">
            <a
              href="/projects"
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

          <nav className="px-3 py-3 space-y-1 flex-1 overflow-y-auto">
            <NavItem href="/quality-gate" label="Review queue" />
            <NavItem href="/recovery" label="Recovery" />

            <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-widest text-ink-muted">
              SEO Intelligence
            </div>
            <NavItem href="/seo" label="Dashboard" exact />

            <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-widest text-ink-muted">
              Intelligence
            </div>
            <NavItem href="/seo/site-health" label="Site Health" />
            <NavItem href="/seo/backlinks" label="Backlinks" />
            <NavItem href="/seo/content-gap" label="Content Gap" />
            <NavItem href="/seo/search-performance" label="Search Performance" />

            <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-widest text-ink-muted">
              Tracking
            </div>
            <NavItem href="/seo/keywords" label="Keywords" />
            <NavItem href="/seo/keyword-lists" label="Lists" />
            <NavItem href="/seo/locations" label="Locations" />
            <NavItem href="/seo/rankings" label="Rankings" />
            <NavItem href="/seo/schedules" label="Schedules" />

            <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-widest text-ink-muted">
              Competitors
            </div>
            <NavItem href="/seo/competitors" label="SERP Competitors" />
            <NavItem href="/seo/insights" label="Insights" />

            {isAdmin && (
              <>
                <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-widest text-ink-muted">
                  Settings
                </div>
                <NavItem href="/seo/integrations" label="Integrations" />
              </>
            )}
          </nav>

          <div className="px-3 py-3 border-t border-rule">
            <div className="px-2 pb-2 text-[10px] text-ink-muted truncate">
              {email}
              {isAdmin && <span className="ml-1 text-accent">· admin</span>}
            </div>
            <a
              href="/"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm hover:bg-secondary transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" /> All modules
            </a>
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

function NavItem({
  href,
  label,
  exact = false,
}: {
  href: string;
  label: string;
  exact?: boolean;
}) {
  const [loc] = useLocation();
  const active = exact ? loc === href : loc === href || loc.startsWith(href + "/");
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

function slugFromName(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function BrandSwitcher() {
  const { loading, accessible, activeBrand, setActiveBrand, isAdmin, refreshBrands } = useActiveBrand();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createDomain, setCreateDomain] = useState("");
  const [createSlugTouched, setCreateSlugTouched] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createErrorMsg, setCreateErrorMsg] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (createOpen) setTimeout(() => nameRef.current?.focus(), 50);
  }, [createOpen]);

  const resetCreate = () => {
    setCreateName(""); setCreateSlug(""); setCreateDomain("");
    setCreateSlugTouched(false); setCreateErrors({}); setCreateErrorMsg("");
  };

  const openCreate = () => { setOpen(false); resetCreate(); setCreateOpen(true); };
  const closeCreate = () => { if (createSaving) return; setCreateOpen(false); resetCreate(); };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimName = createName.trim();
    const trimSlug = createSlug.trim().toLowerCase();
    const trimDomain = createDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const next: Record<string, string> = {};
    if (trimName.length < 2) next.name = "Enter a brand name.";
    else if (trimName.length > 120) next.name = "Too long.";
    if (!trimSlug) next.slug = "Enter a slug.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimSlug)) next.slug = "Lowercase, numbers, single hyphens only.";
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(trimDomain)) {
      next.primary_domain = "Enter a valid domain, e.g. example.com.";
    }
    setCreateErrors(next); setCreateErrorMsg("");
    if (Object.keys(next).length > 0) return;

    setCreateSaving(true);
    try {
      const resp = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimName, slug: trimSlug, primary_domain: trimDomain }),
      });
      const data = await resp.json() as Brand & { error?: string; message?: string; fields?: Record<string, string> };
      if (!resp.ok) {
        if (data.fields && Object.keys(data.fields).length > 0) setCreateErrors(data.fields);
        setCreateErrorMsg(data.message ?? `HTTP ${resp.status}`);
        return;
      }
      const newBrand: Brand = { id: data.id, slug: data.slug, name: data.name, primary_domain: data.primary_domain };
      setActiveBrand(newBrand);
      await refreshBrands();
      closeCreate();
      toast.success(`${data.name} added and selected.`);
    } catch (err) {
      setCreateErrorMsg(err instanceof Error ? err.message : "Could not add brand.");
    } finally {
      setCreateSaving(false);
    }
  };

  if (loading || accessible.length === 0) return null;

  return (
    <div className="px-3 py-3 border-b border-rule">
      {/* Brand picker */}
      {accessible.length === 1 && !createOpen ? (
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Building2 className="h-3.5 w-3.5 text-ink-muted" />
          <span className="text-xs font-medium flex-1 truncate">{accessible[0]!.name}</span>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="text-ink-muted hover:text-accent p-0.5 rounded"
              title="Add brand"
              aria-label="Add brand"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : !createOpen ? (
        <div className="relative">
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
            <div className="absolute left-0 right-0 mt-1 bg-background border border-rule rounded-sm shadow-md z-50 max-h-64 overflow-y-auto">
              {accessible.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setActiveBrand(b); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary ${
                    activeBrand?.id === b.id ? "bg-secondary/60 font-medium" : ""
                  }`}
                >
                  {b.name}
                  <span className="ml-2 text-[10px] font-mono text-ink-muted">{b.slug}</span>
                </button>
              ))}
              {isAdmin && (
                <button
                  onClick={openCreate}
                  className="w-full text-left px-3 py-2 text-sm text-accent hover:bg-secondary border-t border-rule flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> New brand
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Inline create form */}
      {createOpen && (
        <form onSubmit={submitCreate} noValidate className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-ink">New brand</p>
            <button type="button" onClick={closeCreate} className="text-ink-muted hover:text-ink" aria-label="Cancel">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {createErrorMsg && (
            <div role="alert" className="flex items-start gap-1.5 rounded-sm border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {createErrorMsg}
            </div>
          )}

          <div>
            <input
              ref={nameRef}
              value={createName}
              onChange={(e) => { setCreateName(e.target.value); if (!createSlugTouched) setCreateSlug(slugFromName(e.target.value)); }}
              placeholder="Brand name *"
              className={`w-full border rounded-sm px-2 py-1.5 text-xs bg-background text-ink ${createErrors.name ? "border-red-400" : "border-rule"}`}
            />
            {createErrors.name && <p className="text-[11px] text-red-600 mt-0.5">{createErrors.name}</p>}
          </div>
          <div>
            <input
              value={createSlug}
              onChange={(e) => { setCreateSlugTouched(true); setCreateSlug(e.target.value.toLowerCase()); }}
              placeholder="slug *"
              className={`w-full border rounded-sm px-2 py-1.5 text-xs bg-background text-ink font-mono ${createErrors.slug ? "border-red-400" : "border-rule"}`}
            />
            {createErrors.slug && <p className="text-[11px] text-red-600 mt-0.5">{createErrors.slug}</p>}
          </div>
          <div>
            <input
              value={createDomain}
              onChange={(e) => setCreateDomain(e.target.value)}
              placeholder="example.com *"
              className={`w-full border rounded-sm px-2 py-1.5 text-xs bg-background text-ink ${createErrors.primary_domain ? "border-red-400" : "border-rule"}`}
            />
            {createErrors.primary_domain && <p className="text-[11px] text-red-600 mt-0.5">{createErrors.primary_domain}</p>}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={createSaving}
              className="flex-1 inline-flex items-center justify-center gap-1 bg-ink text-paper px-2 py-1.5 rounded-sm text-xs font-medium hover:bg-accent disabled:opacity-40"
            >
              {createSaving && <Loader2 className="h-3 w-3 animate-spin" />}
              {createSaving ? "Adding…" : "Add brand"}
            </button>
            <button type="button" onClick={closeCreate} disabled={createSaving} className="border border-rule px-3 py-1.5 rounded-sm text-xs hover:bg-secondary disabled:opacity-40">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
