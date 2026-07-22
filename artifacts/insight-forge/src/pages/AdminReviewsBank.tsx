import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TagAutocompleteInput } from "@/components/TagAutocompleteInput";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2,
  MessageSquareQuote,
  Upload,
  Trash2,
  ShieldOff,
  ShieldCheck,
  X,
  Tag,
  Tags,
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

type Review = {
  id: string;
  brand_id: string;
  reviewer_name: string;
  reviewer_role: string | null;
  company: string;
  company_industry: string | null;
  project_name: string | null;
  quote_excerpt: string;
  quote_full: string | null;
  rating: string | null;
  source_url: string | null;
  date_published: string | null;
  icp: number | null;
  vertical: string | null;
  cost_bucket: string | null;
  is_confidential: boolean;
  confidential_reason: string | null;
  last_verified_at: string;
  industry_tags: string[];
  keyword_tags: string[];
};

const DELETE_REASONS = [
  "fabricated",
  "misattributed",
  "client_requested_removal",
  "duplicate",
  "other",
] as const;
type DeleteReason = (typeof DELETE_REASONS)[number];

export default function AdminReviewsBank() {
  const { user } = useAuth();
  const { activeBrand } = useActiveBrand();
  const brandId = activeBrand?.id ?? null;

  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<{
    id: string;
    reason: DeleteReason;
    note: string;
  } | null>(null);

  const [fIcp, setFIcp] = useState<string>("");
  const [fVertical, setFVertical] = useState<string>("");
  const [fConf, setFConf] = useState<"all" | "visible" | "confidential">("all");

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState<{ industry: string[]; keyword: string[] }>({
    industry: [],
    keyword: [],
  });
  const [savingTags, setSavingTags] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<{
    industry: string[];
    keyword: string[];
    merge: boolean;
  }>({ industry: [], keyword: [], merge: true });
  const [applyingBulk, setApplyingBulk] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!brandId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/reviews-bank?brandId=${brandId}`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(await resp.text());
      setRows((await resp.json()) as Review[]);
    } catch (e) {
      toast.error("Failed to load reviews: " + (e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const verticals = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.vertical).filter(Boolean))) as string[],
    [rows],
  );
  const icps = useMemo(
    () =>
      Array.from(
        new Set(
          rows.map((r) => r.icp).filter((x): x is number => x != null),
        ),
      ).sort((a, b) => a - b),
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (fIcp && String(r.icp ?? "") !== fIcp) return false;
        if (fVertical && r.vertical !== fVertical) return false;
        if (fConf === "visible" && r.is_confidential) return false;
        if (fConf === "confidential" && !r.is_confidential) return false;
        return true;
      }),
    [rows, fIcp, fVertical, fConf],
  );

  if (user && !user.isAdmin) return <Navigate to="/projects" replace />;

  const onImport = async (file: File) => {
    if (!brandId) {
      toast.error("Select a brand first.");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("File is not valid JSON.");
      }
      const resp = await fetch(
        `/api/admin/reviews-bank/import?brandId=${brandId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(parsed),
        },
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "import failed");
      toast.success(`Imported ${data.imported} review(s).`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleConfidential = async (r: Review) => {
    setBusyId(r.id);
    try {
      const resp = await fetch(`/api/admin/reviews-bank/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_confidential: !r.is_confidential }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const updated = (await resp.json()) as Review;
      setRows((rs) => rs.map((x) => (x.id === r.id ? updated : x)));
    } catch (e) {
      toast.error("Update failed: " + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      const resp = await fetch(`/api/admin/reviews-bank/${deleting.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: deleting.reason, note: deleting.note || null }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "delete failed");
      setRows((rs) => rs.filter((x) => x.id !== deleting.id));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(deleting.id);
        return n;
      });
      toast.success("Review permanently deleted.");
      setDeleting(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const openTagEdit = (r: Review) => {
    setTagEditId(r.id);
    setTagDraft({ industry: [...r.industry_tags], keyword: [...r.keyword_tags] });
  };

  const saveTags = async () => {
    if (!tagEditId) return;
    setSavingTags(true);
    const finalDraft = tagDraft;
    try {
      const resp = await fetch(`/api/admin/reviews-bank/${tagEditId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          industry_tags: finalDraft.industry,
          keyword_tags: finalDraft.keyword,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const updated = (await resp.json()) as Review;
      setRows((rs) => rs.map((x) => (x.id === tagEditId ? updated : x)));
      toast.success("Tags saved.");
      setTagEditId(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingTags(false);
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected((s) => {
        const n = new Set(s);
        filtered.forEach((r) => n.delete(r.id));
        return n;
      });
    } else {
      setSelected((s) => {
        const n = new Set(s);
        filtered.forEach((r) => n.add(r.id));
        return n;
      });
    }
  };

  const applyBulkTags = async () => {
    if (selected.size === 0) return;
    setApplyingBulk(true);
    const kw = bulkDraft.keyword;
    const hasIndustry = bulkDraft.industry.length > 0;
    const hasKeyword = kw.length > 0;
    if (!hasIndustry && !hasKeyword) {
      toast.error("Select at least one tag to apply.");
      setApplyingBulk(false);
      return;
    }
    try {
      const body: Record<string, unknown> = {
        brand_id: brandId,
        ids: Array.from(selected),
        merge: bulkDraft.merge,
      };
      if (hasIndustry) body.industry_tags = bulkDraft.industry;
      if (hasKeyword) body.keyword_tags = kw;
      const resp = await fetch("/api/admin/reviews-bank/bulk-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "bulk tag failed");
      const updatedMap = new Map(
        (data.rows as Review[]).map((r: Review) => [r.id, r]),
      );
      setRows((rs) => rs.map((x) => updatedMap.get(x.id) ?? x));
      toast.success(`Tags applied to ${data.updated as number} review(s).`);
      setSelected(new Set());
      setBulkOpen(false);
      setBulkDraft({ industry: [], keyword: [], merge: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplyingBulk(false);
    }
  };

  return (
    <div className="px-8 py-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl tracking-tight flex items-center gap-2">
            <MessageSquareQuote className="h-6 w-6 text-accent" /> Reviews bank
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            The testimonial corpus for{" "}
            <span className="font-medium text-ink">{activeBrand?.name ?? "—"}</span>. Confidential
            entries are excluded from generation. Assign tags so the planner can match reviews to
            article types.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
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
                <Upload className="h-3.5 w-3.5" /> Import reviews_bank.json
              </>
            )}
          </button>
        </div>
      </div>

      {!brandId ? (
        <p className="text-sm text-ink-muted">
          Select a brand from the switcher to view its reviews.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
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
            <select
              value={fVertical}
              onChange={(e) => setFVertical(e.target.value)}
              className="border border-rule rounded-sm px-2 py-1 bg-background"
            >
              <option value="">All verticals</option>
              {verticals.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={fConf}
              onChange={(e) => setFConf(e.target.value as typeof fConf)}
              className="border border-rule rounded-sm px-2 py-1 bg-background"
            >
              <option value="all">All visibility</option>
              <option value="visible">Visible only</option>
              <option value="confidential">Confidential only</option>
            </select>
            {selected.size > 0 && (
              <button
                onClick={() => setBulkOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-accent text-white text-sm font-medium"
              >
                <Tags className="h-3.5 w-3.5" />
                Bulk tag ({selected.size})
              </button>
            )}
            <span className="text-ink-muted ml-auto">
              {filtered.length} of {rows.length}
              {selected.size > 0 && (
                <>
                  {" · "}
                  <span className="font-medium">{selected.size} selected</span>
                </>
              )}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted py-12 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-muted py-12 text-center border border-dashed border-rule rounded-sm">
              No reviews yet. Import a reviews_bank.json file to populate the bank.
            </p>
          ) : (
            <div className="border border-rule rounded-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-secondary text-ink-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        className="rounded"
                        title="Select all visible"
                      />
                    </th>
                    <th className="text-left px-3 py-2 font-medium">Reviewer / Company</th>
                    <th className="text-left px-3 py-2 font-medium">Quote</th>
                    <th className="text-left px-3 py-2 font-medium">ICP / Vertical</th>
                    <th className="text-left px-3 py-2 font-medium">Tags</th>
                    <th className="text-left px-3 py-2 font-medium">Visibility</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-t border-rule align-top ${selected.has(r.id) ? "bg-accent/5" : ""}`}
                    >
                      <td className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.reviewer_name}</div>
                        <div className="text-ink-muted text-xs">
                          {r.reviewer_role ? `${r.reviewer_role}, ` : ""}
                          {r.company}
                        </div>
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <span className="line-clamp-3 text-ink-muted">{r.quote_excerpt}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.icp != null ? `ICP ${r.icp}` : "—"}
                        <div className="text-ink-muted text-xs">{r.vertical ?? ""}</div>
                      </td>
                      <td className="px-3 py-2 min-w-[160px]">
                        <div className="flex flex-wrap gap-1 mb-1">
                          {r.industry_tags.slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs"
                            >
                              {t.replace(/_/g, " ")}
                            </span>
                          ))}
                          {r.keyword_tags.slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="inline-block px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                            >
                              {t}
                            </span>
                          ))}
                          {r.industry_tags.length + r.keyword_tags.length > 4 && (
                            <span className="text-xs text-ink-muted">
                              +{r.industry_tags.length + r.keyword_tags.length - 4} more
                            </span>
                          )}
                          {r.industry_tags.length === 0 && r.keyword_tags.length === 0 && (
                            <span className="text-xs text-ink-muted italic">No tags</span>
                          )}
                        </div>
                        <button
                          onClick={() => openTagEdit(r)}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <Tag className="h-3 w-3" /> Edit tags
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        {r.is_confidential ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                            <ShieldOff className="h-3.5 w-3.5" /> Confidential
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <ShieldCheck className="h-3.5 w-3.5" /> Visible
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <button
                          disabled={busyId === r.id}
                          onClick={() => toggleConfidential(r)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-secondary text-xs disabled:opacity-50"
                          title={r.is_confidential ? "Mark visible" : "Mark confidential"}
                        >
                          {busyId === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : r.is_confidential ? (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          ) : (
                            <ShieldOff className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            setDeleting({ id: r.id, reason: "fabricated", note: "" })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-red-50 text-red-600 text-xs"
                          title="Hard delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---- Tag edit modal ---- */}
      {tagEditId &&
        (() => {
          const review = rows.find((r) => r.id === tagEditId);
          return (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-background rounded-md border border-rule w-[520px] p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-serif text-lg flex items-center gap-2">
                    <Tag className="h-4 w-4 text-accent" /> Edit tags
                  </h2>
                  <button
                    onClick={() => setTagEditId(null)}
                    className="text-ink-muted hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {review && (
                  <p className="text-xs text-ink-muted mb-4">
                    <span className="font-medium text-ink">{review.reviewer_name}</span> —{" "}
                    {review.company}
                  </p>
                )}

                <div className="mb-4">
                  <label className="block text-xs uppercase tracking-wide text-ink-muted mb-2">
                    Industry tags
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {INDUSTRY_TAGS.map((tag) => (
                      <label
                        key={tag}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={tagDraft.industry.includes(tag)}
                          onChange={(e) =>
                            setTagDraft((d) => ({
                              ...d,
                              industry: e.target.checked
                                ? [...d.industry, tag]
                                : d.industry.filter((t) => t !== tag),
                            }))
                          }
                          className="rounded"
                        />
                        {tag.replace(/_/g, " ")}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mb-5">
                  <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                    Keyword tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tagDraft.keyword.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                      >
                        {t}
                        <button
                          onClick={() =>
                            setTagDraft((d) => ({
                              ...d,
                              keyword: d.keyword.filter((k) => k !== t),
                            }))
                          }
                          className="hover:text-purple-900"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <TagAutocompleteInput
                    brandId={brandId}
                    existing={tagDraft.keyword}
                    onAdd={(tag) =>
                      setTagDraft((d) => ({
                        ...d,
                        keyword: Array.from(new Set([...d.keyword, tag])),
                      }))
                    }
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setTagEditId(null)}
                    className="px-3 py-1.5 rounded-sm border border-rule text-sm hover:bg-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={savingTags}
                    onClick={() => void saveTags()}
                    className="px-3 py-1.5 rounded-sm bg-ink text-paper text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {savingTags ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Save tags"
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ---- Bulk tag modal ---- */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background rounded-md border border-rule w-[520px] p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg flex items-center gap-2">
                <Tags className="h-4 w-4 text-accent" /> Bulk tag {selected.size} review
                {selected.size !== 1 ? "s" : ""}
              </h2>
              <button
                onClick={() => setBulkOpen(false)}
                className="text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-4 text-sm mb-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="bulk-merge"
                  checked={bulkDraft.merge}
                  onChange={() => setBulkDraft((d) => ({ ...d, merge: true }))}
                />
                Merge with existing
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="bulk-merge"
                  checked={!bulkDraft.merge}
                  onChange={() => setBulkDraft((d) => ({ ...d, merge: false }))}
                />
                Replace existing
              </label>
            </div>

            <div className="mb-4">
              <label className="block text-xs uppercase tracking-wide text-ink-muted mb-2">
                Industry tags
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {INDUSTRY_TAGS.map((tag) => (
                  <label
                    key={tag}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={bulkDraft.industry.includes(tag)}
                      onChange={(e) =>
                        setBulkDraft((d) => ({
                          ...d,
                          industry: e.target.checked
                            ? [...d.industry, tag]
                            : d.industry.filter((t) => t !== tag),
                        }))
                      }
                      className="rounded"
                    />
                    {tag.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
                Keyword tags
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {bulkDraft.keyword.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs"
                  >
                    {t}
                    <button
                      onClick={() =>
                        setBulkDraft((d) => ({
                          ...d,
                          keyword: d.keyword.filter((k) => k !== t),
                        }))
                      }
                      className="hover:text-purple-900"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <TagAutocompleteInput
                brandId={brandId}
                existing={bulkDraft.keyword}
                onAdd={(tag) =>
                  setBulkDraft((d) => ({
                    ...d,
                    keyword: Array.from(new Set([...d.keyword, tag])),
                  }))
                }
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBulkOpen(false)}
                className="px-3 py-1.5 rounded-sm border border-rule text-sm hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                disabled={applyingBulk}
                onClick={() => void applyBulkTags()}
                className="px-3 py-1.5 rounded-sm bg-ink text-paper text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {applyingBulk ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…
                  </>
                ) : (
                  `Apply to ${selected.size}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete modal ---- */}
      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-background rounded-md border border-rule w-[440px] p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif text-lg flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-600" /> Permanently delete review
              </h2>
              <button
                onClick={() => setDeleting(null)}
                className="text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-3">
              This is a <strong>hard delete</strong> — the entry is removed from the bank. An audit
              record (with your reason) is retained. A reason is required.
            </p>
            <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
              Reason
            </label>
            <select
              value={deleting.reason}
              onChange={(e) =>
                setDeleting((d) => (d ? { ...d, reason: e.target.value as DeleteReason } : d))
              }
              className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm mb-3"
            >
              {DELETE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <label className="block text-xs uppercase tracking-wide text-ink-muted mb-1">
              Note (optional)
            </label>
            <textarea
              value={deleting.note}
              onChange={(e) => setDeleting((d) => (d ? { ...d, note: e.target.value } : d))}
              rows={2}
              className="w-full border border-rule rounded-sm px-2 py-1.5 bg-background text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleting(null)}
                className="px-3 py-1.5 rounded-sm border border-rule text-sm hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                disabled={busyId === deleting.id}
                onClick={() => void confirmDelete()}
                className="px-3 py-1.5 rounded-sm bg-red-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busyId === deleting.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…
                  </>
                ) : (
                  "Delete permanently"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
