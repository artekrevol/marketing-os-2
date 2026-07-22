import { useCallback, useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  Save,
  Settings,
  LayoutGrid,
} from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { useActiveBrand } from "@/lib/brands";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

const CONTENT_TYPES = [
  { key: "cost_guide", label: "Cost Guide" },
  { key: "comparison_guide", label: "Comparison Guide" },
  { key: "how_to_guide", label: "How-To Guide" },
  { key: "statistics_trends", label: "Statistics & Trends" },
  { key: "explainer", label: "Explainer" },
  { key: "case_study", label: "Case Study" },
  { key: "vertical_deep_dive", label: "Vertical Deep Dive" },
  { key: "thought_leadership", label: "Thought Leadership" },
] as const;

type ContentTypeKey = (typeof CONTENT_TYPES)[number]["key"];

type ActiveSection =
  | "overview"
  | "global"
  | ContentTypeKey
  | "named-projects"
  | "reviews-tagging"
  | "preview";

type Template = {
  id: string;
  brand_id: string;
  scope: "global" | "content_type";
  content_type: string | null;
  version: number;
  template_data: Record<string, unknown>;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
};

type TemplatesState = {
  global: Template | null;
  byType: Record<string, Template>;
};

type GlobalData = {
  citation_authority: {
    dr_minimum: number;
    max_age_years: number;
    max_per_article: number;
    whitelisted_domains: string[];
  };
  brand_voice_global: {
    mentions_per_article_target: number;
    mentions_per_article_max: number;
    mention_styles_vocabulary: string[];
  };
  tone_requirements: {
    affirmative_tone_required: boolean;
    banned_phrases: string[];
  };
  cost_budget: {
    estimated_usd_per_article: number | null;
    daily_brand_cap_usd: number | null;
  };
};

type TypeData = {
  article_structure: {
    target_word_count: number;
    h2_count_target: number;
    section_kinds: string[];
  };
  required_elements: {
    min_named_projects: number;
    min_testimonials: number;
    min_internal_links: number;
    min_external_citations: number;
    [key: string]: boolean | number;
  };
  brand_mention_overrides: {
    mentions_per_article_target: number | null;
    mentions_per_article_max: number | null;
  };
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function defaultGlobal(): GlobalData {
  return {
    citation_authority: { dr_minimum: 80, max_age_years: 3, max_per_article: 3, whitelisted_domains: [] },
    brand_voice_global: { mentions_per_article_target: 5, mentions_per_article_max: 5, mention_styles_vocabulary: ["project_spotlight", "service_highlight", "credential_reference", "first_person_authority", "team_specificity"] },
    tone_requirements: { affirmative_tone_required: true, banned_phrases: [] },
    cost_budget: { estimated_usd_per_article: null, daily_brand_cap_usd: null },
  };
}

function defaultTypeData(): TypeData {
  return {
    article_structure: { target_word_count: 2000, h2_count_target: 5, section_kinds: ["intro", "body", "cta"] },
    required_elements: { min_named_projects: 0, min_testimonials: 0, min_internal_links: 2, min_external_citations: 1 },
    brand_mention_overrides: { mentions_per_article_target: null, mentions_per_article_max: null },
  };
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* -------------------------------------------------------------------------- */
/* Sub-forms                                                                   */
/* -------------------------------------------------------------------------- */

function NumInput({ label, value, onChange, min = 0, step = 1, nullable = false }: {
  label: string; value: number | null; onChange: (v: number | null) => void;
  min?: number; step?: number; nullable?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value ?? ""}
        placeholder={nullable ? "inherit" : ""}
        onChange={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          onChange(v);
        }}
        className="border border-rule rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent w-40"
      />
    </label>
  );
}

function TagListInput({ label, values, onChange, placeholder = "Add…" }: {
  label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || values.includes(t)) return;
    onChange([...values, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</span>
      <div className="flex flex-wrap gap-1 min-h-[32px]">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary text-ink text-xs rounded-full">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-red-500">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="border border-rule rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent flex-1 max-w-xs"
        />
        <button onClick={add} className="px-3 py-1.5 text-xs bg-ink text-paper rounded hover:bg-ink/80">Add</button>
      </div>
    </div>
  );
}

function TextareaInput({ label, value, onChange, help }: {
  label: string; value: string; onChange: (v: string) => void; help?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</span>
      {help && <span className="text-xs text-ink-muted">{help}</span>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="border border-rule rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent resize-y font-mono"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Global rules form                                                           */
/* -------------------------------------------------------------------------- */

function GlobalForm({ data, onChange }: { data: GlobalData; onChange: (d: GlobalData) => void }) {
  const set = <K extends keyof GlobalData>(section: K, patch: Partial<GlobalData[K]>) =>
    onChange({ ...data, [section]: { ...data[section], ...patch } });

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Citation authority</h3>
        <div className="grid grid-cols-3 gap-6">
          <NumInput label="Min domain rating (DR)" value={data.citation_authority.dr_minimum} onChange={(v) => set("citation_authority", { dr_minimum: v ?? 80 })} />
          <NumInput label="Max publication age (years)" value={data.citation_authority.max_age_years} onChange={(v) => set("citation_authority", { max_age_years: v ?? 3 })} />
          <NumInput label="Max citations per article" value={data.citation_authority.max_per_article} onChange={(v) => set("citation_authority", { max_per_article: v ?? 3 })} />
        </div>
        <div className="mt-4">
          <TagListInput
            label="Whitelisted domains"
            values={data.citation_authority.whitelisted_domains}
            onChange={(v) => set("citation_authority", { whitelisted_domains: v })}
            placeholder="e.g. mckinsey.com"
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Brand voice</h3>
        <div className="grid grid-cols-2 gap-6 mb-4">
          <NumInput label="Mentions per article — target" value={data.brand_voice_global.mentions_per_article_target} onChange={(v) => set("brand_voice_global", { mentions_per_article_target: v ?? 5 })} />
          <NumInput label="Mentions per article — max" value={data.brand_voice_global.mentions_per_article_max} onChange={(v) => set("brand_voice_global", { mentions_per_article_max: v ?? 5 })} />
        </div>
        <TagListInput
          label="Mention styles vocabulary"
          values={data.brand_voice_global.mention_styles_vocabulary}
          onChange={(v) => set("brand_voice_global", { mention_styles_vocabulary: v })}
          placeholder="e.g. project_spotlight"
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Tone requirements</h3>
        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={data.tone_requirements.affirmative_tone_required}
            onChange={(e) => set("tone_requirements", { affirmative_tone_required: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm text-ink">Affirmative tone required (no hedging phrases)</span>
        </label>
        <TextareaInput
          label="Banned phrases"
          value={data.tone_requirements.banned_phrases.join("\n")}
          onChange={(v) => set("tone_requirements", { banned_phrases: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
          help="One phrase per line. These phrases will be flagged during generation."
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Cost budget</h3>
        <div className="grid grid-cols-2 gap-6">
          <NumInput label="Max cost per article (USD)" value={data.cost_budget.estimated_usd_per_article} onChange={(v) => set("cost_budget", { estimated_usd_per_article: v })} step={0.10} nullable />
          <NumInput label="Daily brand cap (USD)" value={data.cost_budget.daily_brand_cap_usd} onChange={(v) => set("cost_budget", { daily_brand_cap_usd: v })} step={1} nullable />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-type form                                                               */
/* -------------------------------------------------------------------------- */

function TypeForm({ data, onChange, globalData }: {
  data: TypeData; onChange: (d: TypeData) => void; globalData: GlobalData | null;
}) {
  const set = <K extends keyof TypeData>(section: K, patch: Partial<TypeData[K]>) =>
    onChange({ ...data, [section]: { ...data[section], ...patch } });

  const boolKeys = Object.entries(data.required_elements)
    .filter(([k, v]) => typeof v === "boolean")
    .map(([k]) => k);

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Article structure</h3>
        <div className="grid grid-cols-2 gap-6 mb-4">
          <NumInput label="Target word count" value={data.article_structure.target_word_count} onChange={(v) => set("article_structure", { target_word_count: v ?? 2000 })} />
          <NumInput label="Target H2 count" value={data.article_structure.h2_count_target} onChange={(v) => set("article_structure", { h2_count_target: v ?? 5 })} />
        </div>
        <TagListInput
          label="Section kinds (ordered)"
          values={data.article_structure.section_kinds}
          onChange={(v) => set("article_structure", { section_kinds: v })}
          placeholder="e.g. intro"
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Required elements — minimums</h3>
        <div className="grid grid-cols-2 gap-6">
          <NumInput label="Min named projects" value={data.required_elements.min_named_projects as number} onChange={(v) => set("required_elements", { min_named_projects: v ?? 0 })} />
          <NumInput label="Min testimonials" value={data.required_elements.min_testimonials as number} onChange={(v) => set("required_elements", { min_testimonials: v ?? 0 })} />
          <NumInput label="Min internal links" value={data.required_elements.min_internal_links as number} onChange={(v) => set("required_elements", { min_internal_links: v ?? 2 })} />
          <NumInput label="Min external citations" value={data.required_elements.min_external_citations as number} onChange={(v) => set("required_elements", { min_external_citations: v ?? 1 })} />
        </div>
        {boolKeys.length > 0 && (
          <div className="mt-4 space-y-2">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Required structural elements</span>
            {boolKeys.map((k) => (
              <label key={k} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!data.required_elements[k]}
                  onChange={(e) => set("required_elements", { [k]: e.target.checked })}
                  className="h-4 w-4 accent-accent"
                />
                <span className="text-sm text-ink">{k.replace(/_/g, " ")}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Brand mention overrides</h3>
        <p className="text-xs text-ink-muted mb-4">
          Leave blank to inherit global settings
          {globalData && ` (target: ${globalData.brand_voice_global.mentions_per_article_target}, max: ${globalData.brand_voice_global.mentions_per_article_max})`}.
        </p>
        <div className="grid grid-cols-2 gap-6">
          <NumInput label="Mentions target (override)" value={data.brand_mention_overrides.mentions_per_article_target} onChange={(v) => set("brand_mention_overrides", { mentions_per_article_target: v })} nullable />
          <NumInput label="Mentions max (override)" value={data.brand_mention_overrides.mentions_per_article_max} onChange={(v) => set("brand_mention_overrides", { mentions_per_article_max: v })} nullable />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview section                                                            */
/* -------------------------------------------------------------------------- */

function OverviewSection({ templates, onNavigate }: {
  templates: TemplatesState; onNavigate: (s: ActiveSection) => void;
}) {
  const globalT = templates.global;
  return (
    <div>
      <p className="text-sm text-ink-muted mb-6">
        Active rule sets for this brand. Click any card to edit.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => onNavigate("global")}
          className="text-left p-4 border border-rule rounded-md hover:border-accent/50 hover:bg-secondary/40 transition-colors"
        >
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">Global rules</span>
          </div>
          <div className="text-xs text-ink-muted space-y-0.5">
            {globalT ? (
              <>
                <div>v{globalT.version} · updated {fmt(globalT.created_at)}</div>
                <div>DR ≥ {(globalT.template_data as unknown as GlobalData).citation_authority?.dr_minimum ?? "—"} · {(globalT.template_data as unknown as GlobalData).brand_voice_global?.mentions_per_article_max ?? "—"} brand mentions max</div>
              </>
            ) : <div className="text-ink-muted/60">No template yet</div>}
          </div>
        </button>
        {CONTENT_TYPES.map(({ key, label }) => {
          const t = templates.byType[key] ?? null;
          const d = t?.template_data as unknown as TypeData | undefined;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className="text-left p-4 border border-rule rounded-md hover:border-accent/50 hover:bg-secondary/40 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="h-4 w-4 text-ink-muted" />
                <span className="text-sm font-semibold">{label}</span>
              </div>
              <div className="text-xs text-ink-muted space-y-0.5">
                {t ? (
                  <>
                    <div>v{t.version} · updated {fmt(t.created_at)}</div>
                    <div>{d?.article_structure?.target_word_count ?? "—"}w · {d?.article_structure?.section_kinds?.length ?? "—"} sections</div>
                  </>
                ) : <div className="text-ink-muted/60">No template yet</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview section                                                             */
/* -------------------------------------------------------------------------- */

function PreviewSection({ templates }: { templates: TemplatesState }) {
  const g = templates.global?.template_data as unknown as GlobalData | undefined;
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        A structural preview of how a plan would be configured with current rules applied. Not an AI generation — a rules visualisation.
      </p>
      {!g && (
        <div className="p-4 border border-rule rounded text-sm text-ink-muted">No global rules configured yet.</div>
      )}
      {g && (
        <div className="space-y-4">
          <div className="p-4 border border-rule rounded-md bg-secondary/20">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">Global constraints (all articles)</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-ink-muted">Citation DR floor:</span><span>≥ {g.citation_authority.dr_minimum}</span>
              <span className="text-ink-muted">Max citations:</span><span>{g.citation_authority.max_per_article} per article</span>
              <span className="text-ink-muted">Publication recency:</span><span>≤ {g.citation_authority.max_age_years} years old</span>
              <span className="text-ink-muted">Brand mentions target/max:</span><span>{g.brand_voice_global.mentions_per_article_target} / {g.brand_voice_global.mentions_per_article_max}</span>
              <span className="text-ink-muted">Affirmative tone:</span><span>{g.tone_requirements.affirmative_tone_required ? "Required" : "Not required"}</span>
              <span className="text-ink-muted">Banned phrases:</span><span>{g.tone_requirements.banned_phrases.length} configured</span>
            </div>
          </div>
          {CONTENT_TYPES.map(({ key, label }) => {
            const t = templates.byType[key];
            if (!t) return null;
            const d = t.template_data as unknown as TypeData;
            const mentionTarget = d.brand_mention_overrides.mentions_per_article_target ?? g.brand_voice_global.mentions_per_article_target;
            const mentionMax = d.brand_mention_overrides.mentions_per_article_max ?? g.brand_voice_global.mentions_per_article_max;
            return (
              <div key={key} className="p-4 border border-rule rounded-md">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-3">{label}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-ink-muted">Word count:</span><span>{d.article_structure.target_word_count.toLocaleString()}</span>
                  <span className="text-ink-muted">Sections:</span><span>{d.article_structure.section_kinds.join(" → ")}</span>
                  <span className="text-ink-muted">Brand mentions:</span><span>{mentionTarget} target / {mentionMax} max{d.brand_mention_overrides.mentions_per_article_target !== null ? " (type override)" : " (global)"}</span>
                  <span className="text-ink-muted">Min links / citations:</span><span>{d.required_elements.min_internal_links} internal · {d.required_elements.min_external_citations} external</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main page                                                                   */
/* -------------------------------------------------------------------------- */

export default function AdminRulesDashboard() {
  const { user } = useAuth();
  const { activeBrand } = useActiveBrand();
  const brandId = activeBrand?.id ?? null;

  const [templates, setTemplates] = useState<TemplatesState>({ global: null, byType: {} });
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>("overview");
  const [localData, setLocalData] = useState<GlobalData | TypeData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  if (user && !user.isAdmin) return <Navigate to="/projects" replace />;

  const load = useCallback(async () => {
    if (!brandId) { setLoading(false); return; }
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/content-plan-templates?brandId=${brandId}`, { credentials: "include" });
      if (!resp.ok) throw new Error(await resp.text());
      setTemplates(await resp.json());
    } catch (e) {
      toast.error("Failed to load templates: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const getActiveData = useCallback((): GlobalData | TypeData | null => {
    if (activeSection === "global") {
      const d = templates.global?.template_data;
      return d ? (d as unknown as GlobalData) : defaultGlobal();
    }
    const isType = CONTENT_TYPES.some((ct) => ct.key === activeSection);
    if (isType) {
      const d = templates.byType[activeSection as ContentTypeKey]?.template_data;
      return d ? (d as unknown as TypeData) : defaultTypeData();
    }
    return null;
  }, [activeSection, templates]);

  const handleSectionChange = (s: ActiveSection) => {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Discard them?")) return;
    }
    setActiveSection(s);
    setDirty(false);
    setLocalData(null);
  };

  const effectiveData = localData ?? getActiveData();

  const handleSave = async () => {
    if (!brandId || !effectiveData) return;
    setSaving(true);
    try {
      const isGlobal = activeSection === "global";
      const isType = CONTENT_TYPES.some((ct) => ct.key === activeSection);
      if (!isGlobal && !isType) return;

      const body = {
        brandId,
        scope: isGlobal ? "global" : "content_type",
        contentType: isGlobal ? null : activeSection,
        template_data: effectiveData,
      };
      const resp = await fetch("/api/admin/content-plan-templates", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { template } = await resp.json();
      setTemplates((prev) => {
        if (isGlobal) return { ...prev, global: template };
        return { ...prev, byType: { ...prev.byType, [activeSection]: template } };
      });
      setDirty(false);
      setLocalData(null);
      toast.success(`Saved — version ${template.version}`);
    } catch (e) {
      toast.error("Save failed: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDataChange = (d: GlobalData | TypeData) => {
    setLocalData(d);
    setDirty(true);
  };

  const isEditable = activeSection === "global" || CONTENT_TYPES.some((ct) => ct.key === activeSection);
  const sectionLabel = activeSection === "overview" ? "Overview"
    : activeSection === "global" ? "Global rules"
    : activeSection === "preview" ? "Preview"
    : activeSection === "named-projects" ? "Named projects"
    : activeSection === "reviews-tagging" ? "Reviews bank tagging"
    : CONTENT_TYPES.find((ct) => ct.key === activeSection)?.label ?? activeSection;

  const globalData = templates.global?.template_data as unknown as GlobalData | null ?? null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-rule flex items-center gap-3">
        <Settings className="h-5 w-5 text-accent" />
        <h1 className="font-serif text-xl">Rules Dashboard</h1>
        <p className="text-sm text-ink-muted ml-2">Configure content defaults for all article types.</p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Inner sidebar */}
          <aside className="w-56 shrink-0 border-r border-rule bg-background overflow-y-auto py-3">
            <SidebarItem
              label="Overview"
              icon={<LayoutGrid className="h-4 w-4" />}
              active={activeSection === "overview"}
              onClick={() => handleSectionChange("overview")}
            />
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-ink-muted font-medium">Rules</p>
            </div>
            <SidebarItem
              label="Global rules"
              icon={<Globe className="h-4 w-4" />}
              active={activeSection === "global"}
              onClick={() => handleSectionChange("global")}
              version={templates.global?.version}
            />
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-ink-muted font-medium">By content type</p>
            </div>
            {CONTENT_TYPES.map(({ key, label }) => (
              <SidebarItem
                key={key}
                label={label}
                active={activeSection === key}
                onClick={() => handleSectionChange(key)}
                version={templates.byType[key]?.version}
              />
            ))}
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-ink-muted font-medium">Assets</p>
            </div>
            <SidebarItem
              label="Named projects"
              icon={<ExternalLink className="h-3 w-3 text-ink-muted/50" />}
              active={activeSection === "named-projects"}
              onClick={() => handleSectionChange("named-projects")}
              external
            />
            <SidebarItem
              label="Reviews bank tagging"
              icon={<ExternalLink className="h-3 w-3 text-ink-muted/50" />}
              active={activeSection === "reviews-tagging"}
              onClick={() => handleSectionChange("reviews-tagging")}
              external
            />
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-ink-muted font-medium">Preview</p>
            </div>
            <SidebarItem
              label="Preview mode"
              active={activeSection === "preview"}
              onClick={() => handleSectionChange("preview")}
            />
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-8">
              {/* Header row */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-base font-semibold text-ink">{sectionLabel}</h2>
                  {isEditable && (() => {
                    const t = activeSection === "global" ? templates.global : templates.byType[activeSection as ContentTypeKey];
                    return t ? (
                      <p className="text-xs text-ink-muted mt-0.5">
                        Version {t.version} · last updated {fmt(t.created_at)}
                        {dirty && <span className="ml-2 text-amber-600">· unsaved changes</span>}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-muted mt-0.5">No template yet — saving will create version 1</p>
                    );
                  })()}
                </div>
                {isEditable && (
                  <button
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className="flex items-center gap-2 px-4 py-2 bg-ink text-paper text-sm rounded hover:bg-ink/80 disabled:opacity-40 transition-colors"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save {dirty ? "changes" : "(no changes)"}
                  </button>
                )}
              </div>

              {/* Section content */}
              {activeSection === "overview" && (
                <OverviewSection templates={templates} onNavigate={handleSectionChange} />
              )}
              {activeSection === "global" && effectiveData && (
                <GlobalForm data={effectiveData as GlobalData} onChange={handleDataChange as (d: GlobalData) => void} />
              )}
              {CONTENT_TYPES.some((ct) => ct.key === activeSection) && effectiveData && (
                <TypeForm data={effectiveData as TypeData} onChange={handleDataChange as (d: TypeData) => void} globalData={globalData} />
              )}
              {activeSection === "named-projects" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-muted">
                    Manage named project case evidence — the portfolio the planner uses for project spotlights in articles.
                  </p>
                  <Link
                    to="/admin/named-projects"
                    className="inline-flex items-center gap-2 px-4 py-2 border border-rule rounded text-sm hover:bg-secondary transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" /> Open Named Projects admin
                  </Link>
                  <p className="text-xs text-ink-muted">Full CRUD for named projects is available at the dedicated admin page.</p>
                </div>
              )}
              {activeSection === "reviews-tagging" && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-muted">
                    Tag reviews bank entries with industry and keyword tags so the planner can match testimonials to article topics.
                  </p>
                  <Link
                    to="/admin/reviews-bank"
                    className="inline-flex items-center gap-2 px-4 py-2 border border-rule rounded text-sm hover:bg-secondary transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" /> Open Reviews Bank admin
                  </Link>
                  <p className="text-xs text-ink-muted">Industry and keyword tag fields are available on each review row. Tagging UI extensions arrive in Phase 3.</p>
                </div>
              )}
              {activeSection === "preview" && (
                <PreviewSection templates={templates} />
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ label, icon, active, onClick, version, external }: {
  label: string; icon?: React.ReactNode; active: boolean;
  onClick: () => void; version?: number; external?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
        active ? "bg-ink text-paper" : "text-ink hover:bg-secondary"
      }`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {version !== undefined && !active && (
        <span className="text-[10px] text-ink-muted shrink-0">v{version}</span>
      )}
      {external && !active && <ExternalLink className="h-3 w-3 text-ink-muted/40 shrink-0" />}
    </button>
  );
}
