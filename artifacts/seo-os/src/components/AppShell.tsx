import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ShieldCheck, Building2, ChevronDown, LogOut, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";
import { BrandProvider, useActiveBrand } from "@/lib/brands";

type AuthState = "loading" | "in" | "out" | "blocked" | "writer";

const SEO_OS_ROLES = new Set(["admin", "lead", "reviewer", "outreach"]);

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
    } else if (role === "writer") {
      setAuthState("writer");
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

  if (authState === "writer") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-6">
        <div className="max-w-md border border-rule rounded-md bg-background p-8 text-center">
          <h1 className="font-serif text-xl mb-2">SEO OS is for reviewers</h1>
          <p className="text-sm text-ink-muted mb-1">
            <span className="font-mono">{email}</span> isn't a reviewer or admin.
          </p>
          <p className="text-sm text-ink-muted mb-6">
            Writers stay in ContentForge — submitted drafts surface there with
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

          <nav className="px-3 py-3 space-y-1 flex-1">
            <NavItem href="/quality-gate" label="Review queue" />
            <NavItem href="/recovery" label="Recovery" />
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
