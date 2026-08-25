import { useEffect, useRef, useState } from "react";
import { Loader2, Building2, Save, Plus, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { recordAudit } from "@/lib/audit";
import { useActiveBrand, type Brand } from "@/lib/brands";

type Editing = {
  id: string;
  voice: string;
  thresholds: string;
  domain: string;
};

function slugFromName(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function CreateBrandForm({ onCreated }: { onCreated: (b: Brand) => void }) {
  const { refresh, setActiveBrand } = useActiveBrand();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName(""); setSlug(""); setDomain("");
    setSlugTouched(false); setErrors({}); setErrorMsg("");
  };

  const close = () => { if (saving) return; setOpen(false); reset(); };

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 50);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimName = name.trim();
    const trimSlug = slug.trim().toLowerCase();
    const trimDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const next: Record<string, string> = {};
    if (trimName.length < 2) next.name = "Enter a brand name.";
    else if (trimName.length > 120) next.name = "Brand name must be 120 characters or fewer.";
    if (!trimSlug) next.slug = "Enter a brand slug.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimSlug)) next.slug = "Use lowercase letters, numbers, and single hyphens only.";
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(trimDomain)) {
      next.primary_domain = "Enter a valid domain such as example.com.";
    }
    setErrors(next); setErrorMsg("");
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const resp = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimName, slug: trimSlug, primary_domain: trimDomain }),
      });
      const data = await resp.json() as Brand & { error?: string; message?: string; fields?: Record<string, string> };
      if (!resp.ok) {
        if (resp.status === 409 || (data.fields && Object.keys(data.fields).length > 0)) {
          setErrors(data.fields ?? {});
          setErrorMsg(data.message ?? "A brand with that slug already exists.");
        } else {
          setErrorMsg(data.message ?? `HTTP ${resp.status}`);
        }
        return;
      }
      // Select the new brand before refresh so localStorage slug is set first
      setActiveBrand({ id: data.id, slug: data.slug, name: data.name, primary_domain: data.primary_domain, voice_profile: {}, thresholds: {} });
      await refresh();
      onCreated(data);
      setOpen(false);
      reset();
      toast.success(`${data.name} added and selected.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not add brand.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-8 border border-rule rounded-md bg-background overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="text-xs font-medium">Create brand</p>
          <p className="text-xs text-ink-muted mt-0.5">
            A new brand is immediately available in SEO OS, ContentForge, and all future modules.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 bg-ink text-paper px-3 py-1.5 rounded-sm text-sm font-medium hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Add brand
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} noValidate className="border-t border-rule px-5 py-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Add a brand</p>
              <p className="text-xs text-ink-muted mt-0.5">
                Keywords, locations, and integrations can be configured after creation.
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Cancel" className="text-ink-muted hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>

          {errorMsg && (
            <div role="alert" className="flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs text-ink-muted uppercase tracking-wide">
              Brand name <span className="text-red-600">*</span>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugFromName(e.target.value));
                }}
                aria-invalid={!!errors.name}
                placeholder="Example Company"
                className="mt-1 block w-full border border-rule rounded-sm px-3 py-2 text-sm bg-background normal-case tracking-normal text-ink"
              />
              {errors.name && <span className="block mt-1 text-red-600 normal-case tracking-normal">{errors.name}</span>}
            </label>

            <label className="block text-xs text-ink-muted uppercase tracking-wide">
              Slug <span className="text-red-600">*</span>
              <input
                value={slug}
                onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
                aria-invalid={!!errors.slug}
                placeholder="example-company"
                className="mt-1 block w-full border border-rule rounded-sm px-3 py-2 text-sm bg-background normal-case tracking-normal text-ink font-mono"
              />
              {errors.slug && <span className="block mt-1 text-red-600 normal-case tracking-normal">{errors.slug}</span>}
            </label>
          </div>

          <label className="block text-xs text-ink-muted uppercase tracking-wide">
            Primary domain <span className="text-red-600">*</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-invalid={!!errors.primary_domain}
              placeholder="example.com"
              className="mt-1 block w-full border border-rule rounded-sm px-3 py-2 text-sm bg-background normal-case tracking-normal text-ink"
            />
            {errors.primary_domain && <span className="block mt-1 text-red-600 normal-case tracking-normal">{errors.primary_domain}</span>}
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Adding…" : "Add brand"}
            </button>
            <button type="button" onClick={close} disabled={saving} className="border border-rule px-4 py-2 rounded-sm text-sm hover:bg-secondary disabled:opacity-40">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

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
          Brands are shared across SEO OS, ContentForge, and all future modules. Each brand has its
          own keywords, locations, rankings, and integrations that can be configured after creation.
        </p>
        {!isAdmin && (
          <p className="text-[11px] uppercase tracking-widest text-ink-muted mt-3">
            Read-only view — admin role required to edit.
          </p>
        )}
      </div>

      {isAdmin && (
        <CreateBrandForm
          onCreated={() => load()}
        />
      )}

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
            <p className="text-sm text-ink-muted italic">No brands yet — add one above.</p>
          )}
        </div>
      )}
    </div>
  );
}
