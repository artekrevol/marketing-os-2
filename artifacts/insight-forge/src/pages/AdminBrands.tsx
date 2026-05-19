import { useEffect, useState } from "react";
import { Loader2, Building2, Save } from "lucide-react";
import { toast } from "sonner";
import { recordAudit } from "@/lib/audit";
import { useActiveBrand, type Brand } from "@/lib/brands";

type Editing = {
  id: string;
  voice: string;
  thresholds: string;
  domain: string;
};

export default function AdminBrands() {
  const { isAdmin, refresh } = useActiveBrand();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, Editing>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const resp = await fetch("/api/brands", { credentials: "include" });
    setBrands(resp.ok ? await resp.json() : []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (b: Brand) => {
    setEditing((e) => ({
      ...e,
      [b.id]: {
        id: b.id,
        voice: JSON.stringify(b.voice_profile || {}, null, 2),
        thresholds: JSON.stringify(b.thresholds || {}, null, 2),
        domain: b.primary_domain || "",
      },
    }));
  };

  const cancelEdit = (id: string) => {
    setEditing((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
  };

  const save = async (b: Brand) => {
    const draft = editing[b.id];
    if (!draft) return;
    let voice: Record<string, unknown>;
    let thresholds: Record<string, unknown>;
    try {
      voice = draft.voice.trim() ? JSON.parse(draft.voice) : {};
      thresholds = draft.thresholds.trim() ? JSON.parse(draft.thresholds) : {};
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "parse error";
      toast.error("Invalid JSON: " + msg);
      return;
    }
    const justification = window.prompt(`Why are you editing the ${b.name} brand?`)?.trim();
    if (!justification) {
      toast.error("Justification is required for brand edits.");
      return;
    }
    setSaving(b.id);
    // Audit-first: if the audit write fails, abort the mutation so we never have
    // a sensitive change without a corresponding audit row.
    const audit = await recordAudit(
      "brand.update",
      "brand",
      b.id,
      justification,
      { changed_fields: ["primary_domain", "voice_profile", "thresholds"] },
      b.id,
    );
    if (!audit.ok) {
      toast.error("Audit log failed; change aborted: " + audit.error);
      setSaving(null);
      return;
    }
    const resp = await fetch(`/api/brands/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ primary_domain: draft.domain || null, voice_profile: voice, thresholds }),
    });
    if (!resp.ok) {
      const j = (await resp.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error || `HTTP ${resp.status}`);
      setSaving(null);
      return;
    }
    toast.success(`${b.name} updated`);
    setSaving(null);
    cancelEdit(b.id);
    await load();
    await refresh();
  };

  return (
    <div className="max-w-5xl mx-auto px-10 py-10">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Admin</p>
        <h1 className="font-serif text-3xl mt-1 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-accent" /> Brands
        </h1>
        <p className="text-sm text-ink-muted mt-2 max-w-2xl">
          Four brand tenants. Voice profile and per-brand thresholds (originality cutoff, reading
          grade target) drive Stage-3 scoring and the Quality Gate later in Wave 1.
        </p>
        {!isAdmin && (
          <p className="text-[11px] uppercase tracking-widest text-ink-muted mt-3">
            Read-only view — admin role required to edit.
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading brands…
        </div>
      ) : (
        <div className="space-y-4">
          {brands.map((b) => {
            const draft = editing[b.id];
            const isEditing = !!draft;
            return (
              <div key={b.id} className="notebook-card p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="font-serif text-xl">{b.name}</h2>
                    <p className="text-[11px] uppercase tracking-widest text-ink-muted font-mono">
                      slug: {b.slug}
                    </p>
                  </div>
                  {!isEditing ? (
                    isAdmin ? (
                      <button
                        onClick={() => startEdit(b)}
                        className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary"
                      >
                        Edit
                      </button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-widest text-ink-muted">
                        Read only
                      </span>
                    )
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => cancelEdit(b.id)}
                        className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => save(b)}
                        disabled={saving === b.id}
                        className="text-xs px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {saving === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save with justification
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-ink-muted block mb-1">
                      Primary domain
                    </label>
                    {isEditing ? (
                      <input
                        value={draft.domain}
                        onChange={(e) =>
                          setEditing((s) => ({ ...s, [b.id]: { ...draft, domain: e.target.value } }))
                        }
                        className="w-full px-2 py-1.5 border border-rule rounded-sm text-sm font-mono"
                      />
                    ) : (
                      <p className="text-sm font-mono">{b.primary_domain || "—"}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-ink-muted block mb-1">
                      Voice profile (JSON)
                    </label>
                    {isEditing ? (
                      <textarea
                        value={draft.voice}
                        onChange={(e) =>
                          setEditing((s) => ({ ...s, [b.id]: { ...draft, voice: e.target.value } }))
                        }
                        rows={6}
                        className="w-full px-2 py-1.5 border border-rule rounded-sm text-xs font-mono"
                      />
                    ) : (
                      <pre className="text-[11px] font-mono bg-secondary/40 p-2 rounded-sm overflow-x-auto max-h-32">
                        {JSON.stringify(b.voice_profile || {}, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-ink-muted block mb-1">
                      Thresholds (JSON)
                    </label>
                    {isEditing ? (
                      <textarea
                        value={draft.thresholds}
                        onChange={(e) =>
                          setEditing((s) => ({ ...s, [b.id]: { ...draft, thresholds: e.target.value } }))
                        }
                        rows={6}
                        className="w-full px-2 py-1.5 border border-rule rounded-sm text-xs font-mono"
                      />
                    ) : (
                      <pre className="text-[11px] font-mono bg-secondary/40 p-2 rounded-sm overflow-x-auto max-h-32">
                        {JSON.stringify(b.thresholds || {}, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {brands.length === 0 && (
            <p className="text-sm text-ink-muted italic">No brands seeded yet — run migration 0001.</p>
          )}
        </div>
      )}
    </div>
  );
}
