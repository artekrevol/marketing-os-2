import { useState, type ReactNode } from "react";
import { Building2, ChevronDown } from "lucide-react";
import { useActiveBrand } from "@/lib/brands";

/**
 * Content-only page chrome for the SEO Intelligence module. Mirrors the
 * Recovery page's `Shell` (sticky header + padded body) so SEO pages sit
 * naturally inside the existing seo-os AppShell sidebar layout.
 */
export function SeoShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-rule px-8 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl tracking-tight">{title}</h1>
            {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <SeoBrandSelector />
          </div>
        </div>
      </header>
      <div className="px-8 py-6">{children}</div>
    </div>
  );
}

function SeoBrandSelector() {
  const { loading, accessible, activeBrand, setActiveBrand } = useActiveBrand();
  const [open, setOpen] = useState(false);

  if (loading || accessible.length === 0) return null;

  if (accessible.length === 1) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted px-3 py-1.5 border border-rule rounded-sm">
        <Building2 className="h-3.5 w-3.5" />
        <span className="font-medium text-ink">{accessible[0]!.name}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 border border-rule rounded-sm text-sm hover:bg-secondary transition-colors min-w-[12rem]"
      >
        <Building2 className="h-3.5 w-3.5 text-ink-muted shrink-0" />
        <span className="flex-1 text-left truncate font-medium">
          {activeBrand?.name ?? "Select brand"}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-background border border-rule rounded-sm shadow-md z-50 max-h-64 overflow-y-auto">
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

/**
 * Wraps an SEO page so it only renders its body once a brand is
 * resolved. Handles the loading and no-brand states uniformly.
 */
export function withBrand(
  title: string,
  subtitle: string | undefined,
  render: (brandId: string) => ReactNode,
) {
  return function BrandGated() {
    const { loading, activeBrand, accessible } = useActiveBrand();
    if (loading) return <SeoShell title={title} subtitle="Loading…" />;
    if (!activeBrand) {
      return (
        <SeoShell title={title} subtitle="No brand selected">
          <div className="border border-rule rounded-md bg-background p-6 text-sm text-ink-muted">
            {accessible.length === 0
              ? "You don't have access to any brands yet. Ask an admin to grant brand access."
              : "Select a brand from the sidebar to continue."}
          </div>
        </SeoShell>
      );
    }
    void subtitle;
    return <>{render(activeBrand.id)}</>;
  };
}

/** Small empty/loading/error helpers shared across SEO pages. */
export function StateBox({ children }: { children: ReactNode }) {
  return (
    <div className="border border-rule rounded-md bg-background p-6 text-sm text-ink-muted">
      {children}
    </div>
  );
}
