import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Link2, Upload, Trash2, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useActiveBrand } from "@/lib/brands";

type LinkTarget = {
  id: string;
  brand_id: string;
  url: string;
  page_title: string | null;
  page_type: string;
  content_cluster: string | null;
  vertical: string | null;
  funnel_stage: string;
  primary_icp: number | null;
  primary_keyword: string | null;
  anchor_variations: string[];
  use_for: string | null;
  is_active: boolean;
  last_verified_at: string;
};

type LinkingRule = {
  id: string;
  trigger_pattern: string;
  trigger_keywords: string[];
  primary_target_urls: string[];
  notes: string | null;
};

const FUNNEL_STAGES = ["TOFU", "MOFU", "BOFU"] as const;

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  });
}

export default function AdminLinkTargets() {
  const { user } = useAuth();
  const { activeBrand } = useActiveBrand();
  const brandId = activeBrand?.id ?? null;

  const [targets, setTargets] = useState<LinkTarget[]>([]);
  const [rules, setRules] = useState<LinkingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [fCluster, setFCluster] = useState("");
  const [fFunnel, setFFunnel] = useState("");
  const [fIcp, setFIcp] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!brandId) {
      setTargets([]);
      setRules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/link-targets?brandId=${brandId}`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as {
        link_targets: LinkTarget[];
        linking_rules: LinkingRule[];
      };
      setTargets(data.link_targets);
      setRules(data.linking_rules);
    } catch (e) {
      toast.error("Failed to load link targets: " + (e as Error).message);
      setTargets([]);
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clusters = useMemo(
    () => Array.from(new Set(targets.map((t) => t.content_cluster).filter(Boolean))) as string[],
    [targets],
  );
  const icps = useMemo(
    () =>
      Array.from(
        new Set(targets.map((t) => t.primary_icp).filter((x): x is number => x != null)),
      ).sort((a, b) => a - b),
    [targets],
  );

  const filtered = useMemo(
    () =>
      targets.filter((t) => {
        if (fCluster && t.content_cluster !== fCluster) return false;
        if (fFunnel && t.funnel_stage !== fFunnel) return false;
        if (fIcp && String(t.primary_icp ?? "") !== fIcp) return false;
        return true;
      }),
    [targets, fCluster, fFunnel, fIcp],
  );

  if (user && !user.isAdmin) return <Navigate to="/projects" replace />;

  const onImport = async (file: File) => {
    if (!brandId) {
      toast.error("Select a brand first.");
      return;
    }
    setImporting(true);
    try {
      const isJson = /\.json$/i.test(file.name);
      let body: string;
      if (isJson) {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("File is not valid JSON.");
        }
        body = JSON.stringify(parsed);
      } else {
        const xlsx_base64 = await fileToBase64(file);
        body = JSON.stringify({ xlsx_base64, source_file: file.name });
      }
      const resp = await fetch(`/api/admin/link-targets/import?brandId=${brandId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "import failed");
      toast.success(
        `Imported ${data.imported.link_targets} link target(s), ${data.imported.linking_rules} rule(s).`,
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patchTarget = async (t: LinkTarget, patch: Record<string, unknown>) => {
    setBusyId(t.id);
    try {
      const resp = await fetch(`/api/admin/link-targets/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const updated = (await resp.json()) as LinkTarget;
      setTargets((ts) => ts.map((x) => (x.id === t.id ? updated : x)));
    } catch (e) {
      toast.error("Update failed: " + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const softDelete = async (t: LinkTarget) => {
    if (!confirm(`Deactivate "${t.url}"? It will be excluded from internal linking.`)) return;
    setBusyId(t.id);
    try {
      const resp = await fetch(`/api/admin/link-targets/${t.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) throw new Error(await resp.text());
      setTargets((ts) => ts.filter((x) => x.id !== t.id));
      toast.success("Link target deactivated.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="px-8 py-6 max-w-[1280px]">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl tracking-tight flex items-center gap-2">
            <Link2 className="h-6 w-6 text-accent" /> Link targets
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            The internal-linking corpus for{" "}
            <span className="font-medium text-ink">{activeBrand?.name ?? "—"}</span>. Only active
            targets are used at generation time.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
            }}
          />
          <button
            disabled={importing || !brandId}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm bg-ink text-paper text-sm font-medium disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" /> Import internal_linking.xlsx
              </>
            )}
          </button>
        </div>
      </div>

      {!brandId ? (
        <p className="text-sm text-ink-muted">
          Select a brand from the switcher to view its link targets.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
            <select
              value={fCluster}
              onChange={(e) => setFCluster(e.target.value)}
              className="border border-rule rounded-sm px-2 py-1 bg-background"
            >
              <option value="">All clusters</option>
              {clusters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={fFunnel}
              onChange={(e) => setFFunnel(e.target.value)}
              className="border border-rule rounded-sm px-2 py-1 bg-background"
            >
              <option value="">All funnel stages</option>
              {FUNNEL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={fIcp}
              onChange={(e) => setFIcp(e.target.value)}
              className="border border-rule rounded-sm px-2 py-1 bg-background"
            >
              <option value="">All ICPs</option>
              {icps.map((i) => (
                <option key={i} value={i}>
                  ICP {i}
                </option>
              ))}
            </select>
            <span className="text-ink-muted ml-auto">
              {filtered.length} of {targets.length} active
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted py-12 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-muted py-12 text-center border border-dashed border-rule rounded-sm">
              No active link targets. Import an internal_linking.xlsx file to populate the corpus.
            </p>
          ) : (
            <div className="border border-rule rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-ink-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">URL / Title</th>
                    <th className="text-left px-3 py-2 font-medium">Cluster</th>
                    <th className="text-left px-3 py-2 font-medium">Funnel</th>
                    <th className="text-left px-3 py-2 font-medium">ICP</th>
                    <th className="text-left px-3 py-2 font-medium">Anchors</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-t border-rule align-top">
                      <td className="px-3 py-2 max-w-[320px]">
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline break-all"
                        >
                          {t.url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        <div className="text-ink-muted text-xs">{t.page_title ?? ""}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{t.content_cluster ?? "—"}</td>
                      <td className="px-3 py-2">
                        <select
                          disabled={busyId === t.id}
                          value={t.funnel_stage}
                          onChange={(e) => patchTarget(t, { funnel_stage: e.target.value })}
                          className="border border-rule rounded-sm px-1.5 py-0.5 bg-background text-xs disabled:opacity-50"
                        >
                          {FUNNEL_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {t.primary_icp != null ? `ICP ${t.primary_icp}` : "—"}
                      </td>
                      <td className="px-3 py-2 max-w-[220px]">
                        <span className="text-ink-muted text-xs line-clamp-2">
                          {t.anchor_variations.length > 0 ? t.anchor_variations.join(", ") : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <button
                          disabled={busyId === t.id}
                          onClick={() => softDelete(t)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-red-50 text-red-600 text-xs disabled:opacity-50"
                          title="Deactivate (soft delete)"
                        >
                          {busyId === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rules.length > 0 && (
            <div className="mt-8">
              <h2 className="font-serif text-lg mb-3">Linking rules ({rules.length})</h2>
              <div className="border border-rule rounded-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-ink-muted text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Trigger pattern</th>
                      <th className="text-left px-3 py-2 font-medium">Keywords</th>
                      <th className="text-left px-3 py-2 font-medium">Primary targets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r) => (
                      <tr key={r.id} className="border-t border-rule align-top">
                        <td className="px-3 py-2 font-medium">{r.trigger_pattern}</td>
                        <td className="px-3 py-2 text-ink-muted text-xs max-w-[280px]">
                          {r.trigger_keywords.join(", ") || "—"}
                        </td>
                        <td className="px-3 py-2 text-ink-muted text-xs max-w-[360px] break-all">
                          {r.primary_target_urls.join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
