import { useCallback, useEffect, useState } from "react";
import { TagAutocompleteInput } from "@/components/TagAutocompleteInput";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2,
  Briefcase,
  Plus,
  Pencil,
  Power,
  PowerOff,
  X,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useActiveBrand } from "@/lib/brands";

const INDUSTRY_TAGS = [
  "healthcare",
  "fintech",
  "edtech",
  "real_estate",
  "retail",
  "manufacturing",
  "hospitality",
  "legal",
  "government",
  "nonprofit",
] as const;

type NamedProject = {
  id: string;
  brand_id: string;
  name: string;
  slug: string;
  problem_summary: string;
  approach_summary: string;
  outcome_summary: string;
  industry_tags: string[];
  keyword_tags: string[];
  client_display_name: string | null;
  is_confidential: boolean;
  is_active: boolean;
  is_illustrative: boolean;
  created_at: string;
  updated_at: string;
};

type FormState = {
  name: string;
  slug: string;
  problem_summary: string;
  approach_summary: string;
  outcome_summary: string;
  industry_tags: string[];
  keyword_tags: string[];
  client_display_name: string;
  is_confidential: boolean;
  is_illustrative: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  problem_summary: "",
  approach_summary: "",
  outcome_summary: "",
  industry_tags: [],
  keyword_tags: [],
  client_display_name: "",
  is_confidential: false,
  is_illustrative: false,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formFromProject(p: NamedProject): FormState {
  return {
    name: p.name,
    slug: p.slug,
    problem_summary: p.problem_summary,
    approach_summary: p.approach_summary,
    outcome_summary: p.outcome_summary,
    industry_tags: [...p.industry_tags],
    keyword_tags: [...p.keyword_tags],
    client_display_name: p.client_display_name ?? "",
    is_confidential: p.is_confidential,
    is_illustrative: p.is_illustrative,
  };
}

export default function AdminNamedProjects() {
  const { user } = useAuth();
  const { activeBrand } = useActiveBrand();
  const brandId = activeBrand?.id ?? null;

  const [rows, setRows] = useState<NamedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const [modalMode, setModalMode] = useState<null | "create" | string>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [confirmDeactivate, setConfirmDeactivate] = useState<NamedProject | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const load = useCallback(async () => {
    if (!brandId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/named-projects?brandId=${brandId}`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(await resp.text());
      setRows((await resp.json()) as NamedProject[]);
    } catch (e) {
      toast.error("Failed to load projects: " + (e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (user && !user.isAdmin) return <Navigate to="/projects" replace />;

  const filtered = showInactive ? rows : rows.filter((r) => r.is_active);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModalMode("create");
  };

  const openEdit = (p: NamedProject) => {
    setForm(formFromProject(p));
    setModalMode(p.id);
  };

  const setField = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => {
      const next = { ...f, [key]: val };
      if (key === "name" && !f.slug) next.slug = slugify(val as string);
      return next;
    });

  const toggleIndustryTag = (tag: string) =>
    setForm((f) => ({
      ...f,
      industry_tags: f.industry_tags.includes(tag)
        ? f.industry_tags.filter((t) => t !== tag)
        : [...f.industry_tags, tag],
    }));

  const removeKw = (tag: string) =>
    setForm((f) => ({ ...f, keyword_tags: f.keyword_tags.filter((t) => t !== tag) }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (!brandId) {
      toast.error("Select a brand first.");
      return;
    }
    setSaving(true);
    const body = {
      brand_id: brandId,
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name.trim()),
      problem_summary: form.problem_summary.trim(),
      approach_summary: form.approach_summary.trim(),
      outcome_summary: form.outcome_summary.trim(),
      industry_tags: form.industry_tags,
      keyword_tags: form.keyword_tags,
      client_display_name: form.client_display_name.trim() || null,
      is_confidential: form.is_confidential,
      is_illustrative: form.is_illustrative,
    };
    try {
      const isCreate = modalMode === "create";
      const resp = await fetch(
        isCreate ? "/api/admin/named-projects" : `/api/admin/named-projects/${modalMode}`,
        {
          method: isCreate ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        },
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "save failed");
      const project = data as NamedProject;
      if (isCreate) {
        setRows((rs) => [...rs, project].sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        setRows((rs) => rs.map((x) => (x.id === project.id ? project : x)));
      }
      toast.success(isCreate ? "Project created." : "Project updated.");
      setModalMode(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doDeactivate = async () => {
    if (!confirmDeactivate) return;
    setDeactivating(true);
    try {
      const resp = await fetch(`/api/admin/named-projects/${confirmDeactivate.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "deactivate failed");
      setRows((rs) => rs.map((x) => (x.id === confirmDeactivate.id ? (data as NamedProject) : x)));
      toast.success("Project deactivated.");
      setConfirmDeactivate(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeactivating(false);
    }
  };

  const doReactivate = async (p: NamedProject) => {
    try {
      const resp = await fetch(`/api/admin/named-projects/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_active: true }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "reactivate failed");
      setRows((rs) => rs.map((x) => (x.id === p.id ? (data as NamedProject) : x)));
      toast.success("Project reactivated.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="px-8 py-6 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl tracking-tight flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-accent" /> Named projects
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Case-evidence corpus for{" "}
            <span className="font-medium text-ink">{activeBrand?.name ?? "—"}</span>. Planner
            queries these by industry and keyword tags when generating project spotlight sections.
            Entries marked <span className="text-amber-700 font-medium">Placeholder</span> are
            illustrative — replace with real anonymised client projects.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="flex items-center gap-1.5 text-sm text-ink-muted cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
          {brandId && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm bg-ink text-paper text-sm font-medium"
            >
              <Plus className="h-3.5 w-3.5" /> New project
            </button>
          )}
        </div>
      </div>

      {!brandId ? (
        <p className="text-sm text-ink-muted">Select a brand from the switcher.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-ink-muted py-12 text-center border border-dashed border-rule rounded-sm">
          <p>No {showInactive ? "" : "active "}projects yet.</p>
          <button
            onClick={openCreate}
            className="mt-2 inline-flex items-center gap-1 text-accent hover:underline text-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Create the first project
          </button>
        </div>
      ) : (
        <div className="border border-rule rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Industry tags</th>
                <th className="text-left px-3 py-2 font-medium">Keyword tags</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-rule align-top ${!p.is_active ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap font-medium">
                      {p.name}
                      {p.is_illustrative && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs font-normal">
                          <AlertTriangle className="h-3 w-3" /> Placeholder
                        </span>
                      )}
                    </div>
                    {p.client_display_name && (
                      <div className="text-xs text-ink-muted mt-0.5">{p.client_display_name}</div>
                    )}
                    <div className="text-xs text-ink-muted/60 font-mono mt-0.5">{p.slug}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.industry_tags.map((t) => (
                        <span
                          key={t}
                          className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs"
                        >
                          {t.replace(/_/g, " ")}
                        </span>
                      ))}
                      {p.industry_tags.length === 0 && (
                        <span className="text-xs text-ink-muted italic">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.keyword_tags.map((t) => (
                        <span
                          key={t}
                          className="inline-block px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                        >
                          {t}
                        </span>
                      ))}
                      {p.keyword_tags.length === 0 && (
                        <span className="text-xs text-ink-muted italic">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <Power className="h-3.5 w-3.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                        <PowerOff className="h-3.5 w-3.5" /> Inactive
                      </span>
                    )}
                    {p.is_confidential && (
                      <div className="text-xs text-amber-700 mt-0.5">Confidential</div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <button
                      onClick={() => openEdit(p)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-secondary text-xs"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {p.is_active ? (
                      <button
                        onClick={() => setConfirmDeactivate(p)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-red-50 text-red-600 text-xs"
                        title="Deactivate"
                      >
                        <PowerOff className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => void doReactivate(p)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-emerald-50 text-emerald-600 text-xs"
                        title="Reactivate"
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Create / Edit modal ---- */}
      {modalMode !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto py-8">
          <div className="bg-background rounded-md border border-rule w-[640px] p-6 shadow-xl my-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-serif text-lg">
                {modalMode === "create" ? "New named project" : "Edit project"}
              </h2>
              <button onClick={() => setModalMode(null)} className="text-ink-muted hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm"
                    placeholder="Healthcare Scheduling Modernization"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                    Slug
                  </label>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setField("slug", e.target.value)}
                    className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm font-mono"
                    placeholder="healthcare-scheduling-modernization"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                  Problem summary
                </label>
                <textarea
                  value={form.problem_summary}
                  onChange={(e) => setField("problem_summary", e.target.value)}
                  rows={2}
                  className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm"
                  placeholder="What problem did the client face?"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                  Approach summary
                </label>
                <textarea
                  value={form.approach_summary}
                  onChange={(e) => setField("approach_summary", e.target.value)}
                  rows={2}
                  className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm"
                  placeholder="How did TekRevol solve it?"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                  Outcome summary
                </label>
                <textarea
                  value={form.outcome_summary}
                  onChange={(e) => setField("outcome_summary", e.target.value)}
                  rows={2}
                  className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm"
                  placeholder="What results were achieved?"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-ink-muted mb-2">
                  Industry tags
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {INDUSTRY_TAGS.map((tag) => (
                    <label
                      key={tag}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.industry_tags.includes(tag)}
                        onChange={() => toggleIndustryTag(tag)}
                        className="rounded"
                      />
                      {tag.replace(/_/g, " ")}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                  Keyword tags
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.keyword_tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                    >
                      {t}
                      <button onClick={() => removeKw(t)} className="hover:text-purple-900">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <TagAutocompleteInput
                  brandId={brandId}
                  existing={form.keyword_tags}
                  onAdd={(tag) =>
                    setForm((f) => ({
                      ...f,
                      keyword_tags: Array.from(new Set([...f.keyword_tags, tag])),
                    }))
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                    Client display name (optional)
                  </label>
                  <input
                    type="text"
                    value={form.client_display_name}
                    onChange={(e) => setField("client_display_name", e.target.value)}
                    className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm"
                    placeholder="Acme Health Systems"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_confidential}
                      onChange={(e) => setField("is_confidential", e.target.checked)}
                      className="rounded"
                    />
                    Confidential (exclude from citations)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer text-amber-700">
                    <input
                      type="checkbox"
                      checked={form.is_illustrative}
                      onChange={(e) => setField("is_illustrative", e.target.checked)}
                      className="rounded"
                    />
                    Illustrative placeholder
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-rule">
              <button
                onClick={() => setModalMode(null)}
                className="px-3 py-1.5 rounded-sm border border-rule text-sm hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                onClick={() => void save()}
                className="px-3 py-1.5 rounded-sm bg-ink text-paper text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                  </>
                ) : modalMode === "create" ? (
                  "Create project"
                ) : (
                  "Save changes"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Deactivate confirm ---- */}
      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background rounded-md border border-rule w-[420px] p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-lg flex items-center gap-2">
                <PowerOff className="h-4 w-4 text-red-600" /> Deactivate project
              </h2>
              <button
                onClick={() => setConfirmDeactivate(null)}
                className="text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-4">
              Deactivate <strong>{confirmDeactivate.name}</strong>? The planner will stop using it
              for new content plans. You can reactivate it at any time.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeactivate(null)}
                className="px-3 py-1.5 rounded-sm border border-rule text-sm hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                disabled={deactivating}
                onClick={() => void doDeactivate()}
                className="px-3 py-1.5 rounded-sm bg-red-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {deactivating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deactivating…
                  </>
                ) : (
                  "Deactivate"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
