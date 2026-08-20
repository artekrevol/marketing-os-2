/**
 * Google Integrations admin page — /seo/integrations
 *
 * Per-brand Google OAuth connection management:
 *   1. Connect → opens Google OAuth flow
 *   2. Select GSC property from verified sites list
 *   3. Sync Now → triggers GSC data pull
 *   4. Disconnect → removes stored tokens
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, AlertCircle, Link2, Unlink, RefreshCw,
  Loader2, ChevronDown, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { gsc } from "@/lib/api";
import { SeoShell, StateBox } from "../seo/_shell";
import { useActiveBrand } from "@/lib/brands";
import { useAuth } from "@/lib/useAuth";

/* ── per-brand connection card ────────────────────────────────────────────── */

type ConnectionData = {
  connected: boolean;
  email: string | null;
  gscPropertyUrl: string | null;
  ga4PropertyId: string | null;
  lastSync: Record<string, unknown> | null;
};

function PropertySelector({
  brandId,
  current,
  onSaved,
}: {
  brandId: string;
  current: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const propsQ = useQuery({
    queryKey: ["gsc", "properties", brandId],
    queryFn: () => gsc.properties(brandId),
    enabled: open,
    staleTime: 60_000,
  });

  const sites = (propsQ.data?.sites ?? []) as Array<{ siteUrl: string; permissionLevel: string }>;

  const selectSite = async (siteUrl: string) => {
    setSaving(true);
    try {
      await gsc.saveProperty(brandId, siteUrl);
      toast.success("GSC property saved");
      onSaved();
      setOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 border border-rule rounded-sm px-3 py-1.5 text-sm hover:bg-secondary min-w-[16rem] text-left"
      >
        <span className="flex-1 truncate text-ink-muted">
          {current ?? "Select GSC property…"}
        </span>
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-full bg-background border border-rule rounded-sm shadow-lg z-50 max-h-56 overflow-y-auto">
          {propsQ.isLoading ? (
            <div className="p-4 text-center text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" /> Fetching properties…
            </div>
          ) : sites.length === 0 ? (
            <div className="p-4 text-sm text-ink-muted">No verified properties found for this account.</div>
          ) : (
            sites.map((site) => (
              <button
                key={site.siteUrl}
                onClick={() => selectSite(site.siteUrl)}
                className={`w-full text-left px-3 py-2.5 text-sm hover:bg-secondary transition-colors border-b border-rule last:border-0 ${
                  current === site.siteUrl ? "bg-secondary/60 font-medium" : ""
                }`}
              >
                <div className="truncate">{site.siteUrl}</div>
                <div className="text-[10px] text-ink-muted mt-0.5">{site.permissionLevel}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BrandConnectionCard({ brandId, brandName }: { brandId: string; brandName: string }) {
  const qc = useQueryClient();

  const connQ = useQuery({
    queryKey: ["gsc", "connection", brandId],
    queryFn: () => gsc.connection(brandId),
    staleTime: 30_000,
  });

  const syncM = useMutation({
    mutationFn: () => gsc.sync(brandId),
    onSuccess: () => {
      toast.success("Sync queued — data updates in a few minutes");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["gsc", "connection", brandId] }), 10_000);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnectM = useMutation({
    mutationFn: () => gsc.disconnect(brandId),
    onSuccess: () => {
      toast.success("Google account disconnected");
      qc.invalidateQueries({ queryKey: ["gsc", "connection", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conn = connQ.data as ConnectionData | undefined;
  const lastSync = conn?.lastSync;

  return (
    <div className="border border-rule rounded-md bg-background overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-rule">
        <div>
          <p className="font-medium text-sm">{brandName}</p>
          <p className="text-[11px] text-ink-muted font-mono mt-0.5">{brandId.slice(0, 8)}…</p>
        </div>

        {connQ.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
        ) : conn?.connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted bg-secondary border border-rule rounded-full px-2.5 py-1">
            <AlertCircle className="h-3.5 w-3.5" /> Not connected
          </span>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {conn?.connected ? (
          <>
            {/* Account info */}
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide mb-1">Connected account</p>
              <p className="text-sm font-medium">{conn.email}</p>
            </div>

            {/* GSC property */}
            <div>
              <p className="text-xs text-ink-muted uppercase tracking-wide mb-1.5">GSC property</p>
              <PropertySelector
                brandId={brandId}
                current={conn.gscPropertyUrl}
                onSaved={() => qc.invalidateQueries({ queryKey: ["gsc", "connection", brandId] })}
              />
              {conn.gscPropertyUrl && (
                <a
                  href={`https://search.google.com/search-console?resource_id=${encodeURIComponent(conn.gscPropertyUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                >
                  Open in Search Console <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* Last sync */}
            {lastSync && (
              <div className="text-[11px] text-ink-muted">
                Last sync:{" "}
                <span className={
                  lastSync.status === "done" ? "text-green-600"
                  : lastSync.status === "error" ? "text-red-500"
                  : "text-blue-600"
                }>
                  {lastSync.status === "done"
                    ? `${new Date(lastSync.completed_at as string).toLocaleString()} · ${(lastSync.query_rows_upserted as number ?? 0).toLocaleString()} rows`
                    : lastSync.status === "error"
                    ? `Error: ${lastSync.error_message as string}`
                    : "Syncing…"}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => syncM.mutate()}
                disabled={syncM.isPending || !conn.gscPropertyUrl}
                className="flex items-center gap-1.5 border border-rule rounded-sm px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-40"
              >
                {syncM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync now
              </button>
              <button
                onClick={() => {
                  if (confirm(`Disconnect Google account from ${brandName}?`)) {
                    disconnectM.mutate();
                  }
                }}
                disabled={disconnectM.isPending}
                className="flex items-center gap-1.5 border border-rule rounded-sm px-3 py-1.5 text-sm text-ink-muted hover:bg-secondary hover:text-red-600 disabled:opacity-40"
              >
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <a
            href={`/api/google/oauth/start?brandId=${brandId}`}
            className="inline-flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
          >
            <Link2 className="h-4 w-4" />
            Connect Google account
          </a>
        )}
      </div>
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────────────────── */

export default function GoogleIntegrations() {
  const { user } = useAuth();
  const { loading: brandLoading, activeBrand } = useActiveBrand();

  // Read ?google= param from URL (set by OAuth callback)
  const urlParams = new URLSearchParams(window.location.search);
  const oauthStatus = urlParams.get("google");

  if (!user?.isAdmin) {
    return (
      <SeoShell title="Google Integrations" subtitle="Admin only">
        <StateBox>This page is only accessible to admins.</StateBox>
      </SeoShell>
    );
  }

  if (brandLoading) {
    return (
      <SeoShell title="Google Integrations" subtitle="Loading selected brand…">
        <StateBox>Loading brand…</StateBox>
      </SeoShell>
    );
  }

  if (!activeBrand) {
    return (
      <SeoShell title="Google Integrations" subtitle="No brand selected">
        <StateBox>Select a brand to manage its Google connection.</StateBox>
      </SeoShell>
    );
  }

  return (
    <SeoShell
      title="Google Integrations"
      subtitle={`Connect ${activeBrand.name}'s Google account to enable Search Console data`}
    >
      {oauthStatus === "connected" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Google account connected successfully. Select a GSC property below to start syncing.
        </div>
      )}
      {oauthStatus === "error" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Google connection failed: {urlParams.get("reason") ?? "unknown error"}. Please try again.
        </div>
      )}
      {oauthStatus === "denied" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Google authorization was denied. Click "Connect" again and approve all requested permissions.
        </div>
      )}

      <div className="mb-4 border border-rule rounded-md bg-secondary/20 px-4 py-3 text-sm text-ink-muted">
        <strong className="text-ink">Setup:</strong> Connect the selected brand's Google account.
        The Google account must have Search Console access to {activeBrand.name}'s property.
        Data syncs automatically every night at 4am UTC, or you can trigger a manual sync per brand.
      </div>

      <div className="space-y-4 mt-2">
        <BrandConnectionCard
          brandId={activeBrand.id}
          brandName={activeBrand.name}
        />
      </div>
    </SeoShell>
  );
}
