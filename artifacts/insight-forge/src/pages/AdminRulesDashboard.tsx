import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronRight,
  Clock,
  Eye,
  ExternalLink,
  Globe,
  History,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Save,
  Settings,
  X,
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
type ActiveSection = "overview" | "global" | ContentTypeKey | "named-projects" | "reviews-tagging" | "preview";

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
type TemplatesState = { global: Template | null; byType: Record<string, Template> };

type VersionRow = {
  id: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  createdBy: string | null;
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
  tone_requirements: { affirmative_tone_required: boolean; banned_phrases: string[] };
  cost_budget: { estimated_usd_per_article: number | null; daily_brand_cap_usd: number | null };
};

type TypeData = {
  article_structure: { target_word_count: number; h2_count_target: number; section_kinds: string[] };
  required_elements: {
    min_named_projects: number; min_testimonials: number;
    min_internal_links: number; min_external_citations: number;
    [key: string]: boolean | number;
  };
  brand_mention_overrides: { mentions_per_article_target: number | null; mentions_per_article_max: number | null };
  citation_authority_overrides: {
    dr_minimum: number | null;
    max_age_years: number | null;
    max_per_article: number | null;
    domain_min_dr: Record<string, number>;
  };
};

type ResolvedTemplate = {
  contentType: string;
  versions: { global: number; perType: number | null };
  citationAuthority: {
    drMinimum: number; maxAgeYears: number; maxPerArticle: number;
    whitelistedDomains: Array<{ domain: string; effectiveDrMinimum: number }>;
  };
  brandVoice: { mentionsPerArticleTarget: number; mentionsPerArticleMax: number; mentionStylesVocabulary: string[] };
  toneRequirements: { affirmativeToneRequired: boolean; bannedPhrases: string[] };
  costBudget: { estimatedUsdPerArticle: number | null; dailyBrandCapUsd: number | null };
  articleStructure: { targetWordCount: number; h2CountTarget: number; sectionKinds: string[] } | null;
  requiredElements: { minNamedProjects: number; minTestimonials: number; minInternalLinks: number; minExternalCitations: number; booleanFlags: Record<string, boolean> } | null;
  provenance: {
    mentionsPerArticleTarget: "global" | "per_type";
    mentionsPerArticleMax: "global" | "per_type";
    drMinimum: "global" | "per_type";
    maxAgeYears: "global" | "per_type";
    maxPerArticle: "global" | "per_type";
  };
};

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

function defaultGlobal(): GlobalData {
  return {
    citation_authority: { dr_minimum: 80, max_age_years: 3, max_per_article: 3, whitelisted_domains: [] },
    brand_voice_global: { mentions_per_article_target: 5, mentions_per_article_max: 5, mention_styles_vocabulary: ["project_spotlight", "service_highlight", "credential_reference", "first_person_authority", "team_specificity"] },
    tone_requirements: { affirmative_tone_required: true, banned_phrases: [] },
    cost_budget: { estimated_usd_per_article: null, daily_brand_cap_usd: null },
  };
}
/**
 * Per-type defaults — section kinds, boolean flags, and structural targets.
 * These power both the "new template" initial state AND the Overview card
 * descriptions. Mirrors the cascade map: only per-type-specific fields live
 * here; cascadable fields (mentions, DR, etc.) always start as null (inherit).
 */
const TYPE_DEFAULTS: Record<ContentTypeKey, {
  wordCount: number;
  h2CountTarget: number;
  sectionKinds: string[];
  booleanFlags: Record<string, boolean>;
  description: string;
}> = {
  cost_guide: {
    wordCount: 2500, h2CountTarget: 6,
    sectionKinds: ["intro", "cost_overview", "cost_factors", "cost_by_scope", "comparison", "faq", "cta"],
    booleanFlags: { must_include_price_table: true, must_include_cta: true },
    description: "Pricing transparency articles. Requires cost breakdown table and scope-by-scope comparison.",
  },
  comparison_guide: {
    wordCount: 2200, h2CountTarget: 5,
    sectionKinds: ["intro", "comparison_table", "factor_breakdown", "pros_cons", "recommendation", "cta"],
    booleanFlags: { must_include_comparison_table: true, must_include_cta: true },
    description: "Side-by-side comparison of services, tools, or vendors. Requires a comparison table.",
  },
  how_to_guide: {
    wordCount: 1800, h2CountTarget: 5,
    sectionKinds: ["intro", "prerequisites", "steps", "common_mistakes", "troubleshooting", "cta"],
    booleanFlags: { must_include_numbered_steps: true, must_include_cta: true },
    description: "Step-by-step instruction articles. Numbered steps required.",
  },
  statistics_trends: {
    wordCount: 2000, h2CountTarget: 5,
    sectionKinds: ["intro", "key_statistics", "trend_analysis", "industry_implications", "expert_outlook", "conclusion"],
    booleanFlags: { must_include_data_sources_section: true },
    description: "Data-led articles summarising industry statistics. External citation count is higher than other types.",
  },
  explainer: {
    wordCount: 1500, h2CountTarget: 6,
    sectionKinds: ["intro", "what_is", "how_it_works", "why_it_matters", "examples", "cta"],
    booleanFlags: { must_include_cta: true },
    description: "Foundational explainers for awareness-stage readers. Clear definitions required.",
  },
  case_study: {
    wordCount: 1800, h2CountTarget: 6,
    sectionKinds: ["intro", "client_background", "challenge", "solution", "implementation", "results", "conclusion"],
    booleanFlags: { must_include_metrics: true, must_include_client_quote: true },
    description: "Client success stories. Requires measurable outcomes and an attributed client quote.",
  },
  vertical_deep_dive: {
    wordCount: 3000, h2CountTarget: 7,
    sectionKinds: ["intro", "industry_overview", "market_dynamics", "key_challenges", "solution_landscape", "case_evidence", "outlook"],
    booleanFlags: { must_include_industry_data: true },
    description: "Long-form vertical reports for advanced readers. Highest word count and citation density.",
  },
  thought_leadership: {
    wordCount: 2000, h2CountTarget: 5,
    sectionKinds: ["intro", "thesis_statement", "evidence_and_argument", "counterargument", "resolution", "call_to_action"],
    booleanFlags: { must_include_original_opinion: true },
    description: "Opinion and perspective pieces. Must carry an explicit original thesis.",
  },
};

function defaultTypeDataForType(key: ContentTypeKey): TypeData {
  const d = TYPE_DEFAULTS[key];
  return {
    article_structure: { target_word_count: d.wordCount, h2_count_target: d.h2CountTarget, section_kinds: d.sectionKinds },
    required_elements: {
      min_named_projects: 0, min_testimonials: 0,
      min_internal_links: 2, min_external_citations: 1,
      ...d.booleanFlags,
    },
    brand_mention_overrides: { mentions_per_article_target: null, mentions_per_article_max: null },
    citation_authority_overrides: { dr_minimum: null, max_age_years: null, max_per_article: null, domain_min_dr: {} },
  };
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtShort(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* -------------------------------------------------------------------------- */
/* Primitive inputs                                                            */
/* -------------------------------------------------------------------------- */

function NumInput({ label, value, onChange, min = 0, step = 1, nullable = false, className = "", max }: {
  label?: string; value: number | null; onChange: (v: number | null) => void;
  min?: number; max?: number; step?: number; nullable?: boolean; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</span>}
      <input
        type="number" min={min} max={max} step={step} value={value ?? ""}
        placeholder={nullable ? "—" : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="border border-rule rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent w-36"
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
      <div className="flex flex-wrap gap-1 min-h-[28px]">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary text-ink text-xs rounded-full">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-red-500 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="border border-rule rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent flex-1 max-w-xs" />
        <button onClick={add} className="px-3 py-1 text-xs bg-ink text-paper rounded hover:bg-ink/80">Add</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inherit/Override toggle — the core UI primitive for cascadable fields       */
/* -------------------------------------------------------------------------- */

/**
 * Shows a field that can either inherit from global or be explicitly overridden.
 * When inheriting: shows greyed dashed box with the global value.
 * When overriding: renders the input with a "Clear (inherit)" affordance.
 * Rabia never wonders whether an empty field means "inherit" or "explicitly zero."
 */
function InheritField({ label, globalValue, value, onChange, children, help }: {
  label: string;
  globalValue: number | string;
  value: number | null;
  onChange: (v: number | null) => void;
  children: (v: number, onChangeFn: (n: number) => void) => React.ReactNode;
  help?: string;
}) {
  const inheriting = value === null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</span>
          {help && <span className="text-xs text-ink-muted ml-2">— {help}</span>}
        </div>
        <button
          onClick={() => onChange(inheriting ? Number(globalValue) : null)}
          className={`text-xs px-2.5 py-0.5 rounded-full border shrink-0 transition-colors ${
            inheriting
              ? "bg-secondary border-rule text-ink-muted hover:border-accent/40 hover:text-ink"
              : "bg-accent/10 border-accent/40 text-accent hover:bg-accent/20"
          }`}
        >
          {inheriting ? `Inherit (${globalValue})` : "Override ↑"}
        </button>
      </div>
      {inheriting ? (
        <div className="text-sm text-ink-muted/60 italic px-3 py-1.5 border border-dashed border-rule rounded-sm bg-secondary/20">
          {globalValue} — from global rules
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {children(value!, (n) => onChange(n))}
          <button onClick={() => onChange(null)} className="text-xs text-ink-muted hover:text-ink underline-offset-2 hover:underline shrink-0">
            Clear (inherit)
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Global rules form                                                           */
/* -------------------------------------------------------------------------- */

function GlobalForm({ data, onChange }: { data: GlobalData; onChange: (d: GlobalData) => void }) {
  const set = <K extends keyof GlobalData>(k: K, patch: Partial<GlobalData[K]>) =>
    onChange({ ...data, [k]: { ...data[k], ...patch } });

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Citation authority</h3>
        <div className="grid grid-cols-3 gap-6 mb-4">
          <NumInput label="Min domain rating (DR)" value={data.citation_authority.dr_minimum}
            onChange={(v) => set("citation_authority", { dr_minimum: v ?? 80 })} />
          <NumInput label="Max publication age (years)" value={data.citation_authority.max_age_years}
            onChange={(v) => set("citation_authority", { max_age_years: v ?? 3 })} />
          <NumInput label="Max citations per article" value={data.citation_authority.max_per_article}
            onChange={(v) => set("citation_authority", { max_per_article: v ?? 3 })} />
        </div>
        <TagListInput label="Whitelisted domains" values={data.citation_authority.whitelisted_domains}
          onChange={(v) => set("citation_authority", { whitelisted_domains: v })}
          placeholder="e.g. statista.com" />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Brand voice</h3>
        <div className="grid grid-cols-2 gap-6 mb-4">
          <NumInput label="Mentions per article — target" value={data.brand_voice_global.mentions_per_article_target}
            onChange={(v) => set("brand_voice_global", { mentions_per_article_target: v ?? 5 })} />
          <NumInput label="Mentions per article — max" value={data.brand_voice_global.mentions_per_article_max}
            onChange={(v) => set("brand_voice_global", { mentions_per_article_max: v ?? 5 })} />
        </div>
        <TagListInput label="Mention styles vocabulary"
          values={data.brand_voice_global.mention_styles_vocabulary}
          onChange={(v) => set("brand_voice_global", { mention_styles_vocabulary: v })}
          placeholder="e.g. project_spotlight" />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Tone requirements</h3>
        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={data.tone_requirements.affirmative_tone_required}
            onChange={(e) => set("tone_requirements", { affirmative_tone_required: e.target.checked })}
            className="h-4 w-4 accent-accent" />
          <span className="text-sm">Affirmative tone required (no hedging phrases)</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Banned phrases</span>
          <span className="text-xs text-ink-muted">One phrase per line. Flagged during generation.</span>
          <textarea value={data.tone_requirements.banned_phrases.join("\n")}
            onChange={(e) => set("tone_requirements", { banned_phrases: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
            rows={5} className="border border-rule rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent resize-y font-mono" />
        </label>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Cost budget</h3>
        <div className="grid grid-cols-2 gap-6">
          <NumInput label="Max cost per article (USD)" value={data.cost_budget.estimated_usd_per_article}
            onChange={(v) => set("cost_budget", { estimated_usd_per_article: v })} step={0.10} nullable />
          <NumInput label="Daily brand cap (USD)" value={data.cost_budget.daily_brand_cap_usd}
            onChange={(v) => set("cost_budget", { daily_brand_cap_usd: v })} nullable />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-type form with inherit/override toggles                                 */
/* -------------------------------------------------------------------------- */

function TypeForm({ data, onChange, globalData, contentType, brandId }: {
  data: TypeData; onChange: (d: TypeData) => void; globalData: GlobalData | null;
  contentType: ContentTypeKey; brandId: string;
}) {
  const setStructure = (patch: Partial<TypeData["article_structure"]>) =>
    onChange({ ...data, article_structure: { ...data.article_structure, ...patch } });
  const setReq = (patch: Partial<TypeData["required_elements"]>) =>
    onChange({ ...data, required_elements: { ...data.required_elements, ...patch } as TypeData["required_elements"] });
  const setMention = (patch: Partial<TypeData["brand_mention_overrides"]>) =>
    onChange({ ...data, brand_mention_overrides: { ...data.brand_mention_overrides, ...patch } });
  const setCit = (patch: Partial<TypeData["citation_authority_overrides"]>) =>
    onChange({ ...data, citation_authority_overrides: { ...data.citation_authority_overrides, ...patch } });

  const g = globalData;
  const boolKeys = Object.entries(data.required_elements)
    .filter(([, v]) => typeof v === "boolean").map(([k]) => k);

  const [newDomain, setNewDomain] = useState("");
  const [newDomainDr, setNewDomainDr] = useState<number | null>(null);

  return (
    <div className="space-y-8">
      {/* Type description */}
      {TYPE_DEFAULTS[contentType]?.description && (
        <p className="text-sm text-ink-muted -mt-2 pb-2 border-b border-rule/50">
          {TYPE_DEFAULTS[contentType].description}
        </p>
      )}

      {/* Article structure */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Article structure</h3>
        <div className="grid grid-cols-2 gap-6 mb-4">
          <NumInput label="Target word count" value={data.article_structure.target_word_count}
            onChange={(v) => setStructure({ target_word_count: v ?? 2000 })} />
          <NumInput label="Target H2 count" value={data.article_structure.h2_count_target}
            onChange={(v) => setStructure({ h2_count_target: v ?? 5 })} />
        </div>
        <TagListInput label="Section kinds (ordered)" values={data.article_structure.section_kinds}
          onChange={(v) => setStructure({ section_kinds: v })} placeholder="e.g. intro" />
      </section>

      {/* Required elements */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">Required elements</h3>
        <div className="grid grid-cols-2 gap-6">
          <NumInput label="Min named projects" value={data.required_elements.min_named_projects as number}
            onChange={(v) => setReq({ min_named_projects: v ?? 0 })} />
          <NumInput label="Min testimonials" value={data.required_elements.min_testimonials as number}
            onChange={(v) => setReq({ min_testimonials: v ?? 0 })} />
          <NumInput label="Min internal links" value={data.required_elements.min_internal_links as number}
            onChange={(v) => setReq({ min_internal_links: v ?? 2 })} />
          <NumInput label="Min external citations" value={data.required_elements.min_external_citations as number}
            onChange={(v) => setReq({ min_external_citations: v ?? 1 })} />
        </div>
        {boolKeys.length > 0 && (
          <div className="mt-4 space-y-2">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Required structural elements</span>
            {boolKeys.map((k) => (
              <label key={k} className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={!!data.required_elements[k]}
                  onChange={(e) => setReq({ [k]: e.target.checked })} className="h-4 w-4 accent-accent" />
                <span className="text-sm">{k.replace(/_/g, " ")}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Brand voice overrides — with inherit/override toggles */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">
          Brand voice
          {g && <span className="text-xs font-normal text-ink-muted ml-2">Global: target {g.brand_voice_global.mentions_per_article_target}, max {g.brand_voice_global.mentions_per_article_max}</span>}
        </h3>
        <div className="space-y-5">
          <InheritField
            label="Mentions per article — target"
            globalValue={g?.brand_voice_global.mentions_per_article_target ?? 5}
            value={data.brand_mention_overrides.mentions_per_article_target}
            onChange={(v) => setMention({ mentions_per_article_target: v })}
          >
            {(val, onCh) => <NumInput value={val} onChange={(n) => onCh(n ?? val)} min={0} />}
          </InheritField>
          <InheritField
            label="Mentions per article — max"
            globalValue={g?.brand_voice_global.mentions_per_article_max ?? 5}
            value={data.brand_mention_overrides.mentions_per_article_max}
            onChange={(v) => setMention({ mentions_per_article_max: v })}
          >
            {(val, onCh) => <NumInput value={val} onChange={(n) => onCh(n ?? val)} min={0} />}
          </InheritField>
        </div>
      </section>

      {/* Citation authority overrides — with inherit/override toggles */}
      <section>
        <h3 className="text-sm font-semibold text-ink mb-4 pb-2 border-b border-rule">
          Citation authority overrides
          {g && <span className="text-xs font-normal text-ink-muted ml-2">Global: DR {g.citation_authority.dr_minimum}, age ≤{g.citation_authority.max_age_years}y, max {g.citation_authority.max_per_article}</span>}
        </h3>
        <div className="space-y-5">
          <InheritField
            label="Min domain rating (DR)"
            globalValue={g?.citation_authority.dr_minimum ?? 80}
            value={data.citation_authority_overrides.dr_minimum}
            onChange={(v) => setCit({ dr_minimum: v })}
          >
            {(val, onCh) => <NumInput value={val} onChange={(n) => onCh(n ?? val)} min={0} max={100} />}
          </InheritField>
          <InheritField
            label="Max publication age (years)"
            globalValue={g?.citation_authority.max_age_years ?? 3}
            value={data.citation_authority_overrides.max_age_years}
            onChange={(v) => setCit({ max_age_years: v })}
          >
            {(val, onCh) => <NumInput value={val} onChange={(n) => onCh(n ?? val)} min={1} />}
          </InheritField>
          <InheritField
            label="Max citations per article"
            globalValue={g?.citation_authority.max_per_article ?? 3}
            value={data.citation_authority_overrides.max_per_article}
            onChange={(v) => setCit({ max_per_article: v })}
          >
            {(val, onCh) => <NumInput value={val} onChange={(n) => onCh(n ?? val)} min={1} />}
          </InheritField>

          {/* Per-domain DR overrides */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">Domain-specific DR overrides</span>
            <p className="text-xs text-ink-muted">Override the DR minimum for a specific domain in this content type. Per-type wins when the same domain appears in global whitelist.</p>
            {Object.keys(data.citation_authority_overrides.domain_min_dr).length === 0 && (
              <p className="text-xs text-ink-muted/50 italic">No domain overrides configured.</p>
            )}
            {Object.entries(data.citation_authority_overrides.domain_min_dr).map(([domain, minDr]) => (
              <div key={domain} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-ink">{domain}</span>
                <span className="text-ink-muted">DR ≥</span>
                <input type="number" min={0} max={100} value={minDr}
                  onChange={(e) => setCit({ domain_min_dr: { ...data.citation_authority_overrides.domain_min_dr, [domain]: Number(e.target.value) } })}
                  className="border border-rule rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent w-20" />
                <button onClick={() => {
                  const { [domain]: _, ...rest } = data.citation_authority_overrides.domain_min_dr;
                  setCit({ domain_min_dr: rest });
                }} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            ))}
            <div className="flex items-end gap-2 mt-1">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">Domain</span>
                <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="e.g. statista.com"
                  className="border border-rule rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent w-48" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">Min DR</span>
                <input type="number" min={0} max={100} value={newDomainDr ?? ""}
                  onChange={(e) => setNewDomainDr(e.target.value === "" ? null : Number(e.target.value))}
                  className="border border-rule rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-accent w-20" />
              </label>
              <button onClick={() => {
                const d = newDomain.trim();
                if (!d || newDomainDr === null) return;
                setCit({ domain_min_dr: { ...data.citation_authority_overrides.domain_min_dr, [d]: newDomainDr } });
                setNewDomain(""); setNewDomainDr(null);
              }} className="px-3 py-1.5 text-xs bg-ink text-paper rounded hover:bg-ink/80 mb-0.5">Add</button>
            </div>
          </div>
        </div>
      </section>

      {/* Inline resolved-rules preview for this content type */}
      <ResolvedPreviewPanel brandId={brandId} contentType={contentType} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline resolved-preview panel (per-type forms only)                        */
/* -------------------------------------------------------------------------- */

/**
 * Collapsible panel at the foot of each per-type form. Calls /resolve for
 * exactly this content type so Rabia can see what the planner will actually
 * receive — without navigating to the global Preview section.
 *
 * Loads lazily on first open and caches the result in local state. Calling
 * "Refresh" (or re-opening after a save) triggers a fresh fetch.
 */
function ResolvedPreviewPanel({ brandId, contentType }: { brandId: string; contentType: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<ResolvedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = async () => {
    if (!brandId) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(
        `/api/admin/content-plan-templates/resolve?brandId=${brandId}&contentType=${contentType}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(await r.text());
      setResolved(await r.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const toggle = () => {
    if (!open && !resolved) fetch_();
    setOpen((o) => !o);
  };

  const prov = (p: "global" | "per_type") =>
    p === "per_type"
      ? <span className="text-[10px] text-accent font-medium ml-1">override</span>
      : <span className="text-[10px] text-ink-muted/50 ml-1">global</span>;

  return (
    <div className="border-t border-rule pt-6 mt-2">
      <div className="flex items-center gap-3">
        <button onClick={toggle}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors">
          <Eye className="h-3.5 w-3.5" />
          {open ? "Hide resolved preview" : "Preview resolved rules for this type"}
        </button>
        {open && resolved && !loading && (
          <button onClick={fetch_} className="text-xs text-ink-muted/50 hover:text-ink-muted transition-colors">
            Refresh
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          {resolved && !loading && (
            <div className="p-4 bg-secondary/30 rounded-md border border-rule space-y-1.5 text-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Resolved — {resolved.contentType.replace(/_/g, " ")}
                </span>
                <span className="text-[10px] text-ink-muted">
                  global v{resolved.versions.global}
                  {resolved.versions.perType !== null ? ` · type v${resolved.versions.perType}` : ""}
                </span>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                <span className="text-ink-muted text-xs">Word count</span>
                <span className="text-xs">{resolved.articleStructure?.targetWordCount.toLocaleString() ?? "—"}</span>
                <span className="text-ink-muted text-xs">Sections</span>
                <span className="text-xs truncate">{resolved.articleStructure?.sectionKinds.join(" → ") ?? "—"}</span>
                <span className="text-ink-muted text-xs">Mentions target</span>
                <span className="text-xs">{resolved.brandVoice.mentionsPerArticleTarget} {prov(resolved.provenance.mentionsPerArticleTarget)}</span>
                <span className="text-ink-muted text-xs">Mentions max</span>
                <span className="text-xs">{resolved.brandVoice.mentionsPerArticleMax} {prov(resolved.provenance.mentionsPerArticleMax)}</span>
                <span className="text-ink-muted text-xs">DR minimum</span>
                <span className="text-xs">≥ {resolved.citationAuthority.drMinimum} {prov(resolved.provenance.drMinimum)}</span>
                <span className="text-ink-muted text-xs">Max age (years)</span>
                <span className="text-xs">≤ {resolved.citationAuthority.maxAgeYears} {prov(resolved.provenance.maxAgeYears)}</span>
                <span className="text-ink-muted text-xs">Max citations</span>
                <span className="text-xs">{resolved.citationAuthority.maxPerArticle} {prov(resolved.provenance.maxPerArticle)}</span>
                {resolved.citationAuthority.whitelistedDomains.length > 0 && (
                  <>
                    <span className="text-ink-muted text-xs">Domain overrides</span>
                    <span className="text-xs">
                      {resolved.citationAuthority.whitelistedDomains
                        .map((d) => `${d.domain} (DR ${d.effectiveDrMinimum})`)
                        .join(", ")}
                    </span>
                  </>
                )}
                <span className="text-ink-muted text-xs">Internal / external</span>
                <span className="text-xs">
                  {resolved.requiredElements?.minInternalLinks ?? "—"} links ·{" "}
                  {resolved.requiredElements?.minExternalCitations ?? "—"} citations
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Version history panel                                                       */
/* -------------------------------------------------------------------------- */

function VersionHistoryPanel({ versions, onClose, onRestore, saving }: {
  versions: VersionRow[]; onClose: () => void; onRestore: (id: string, version: number) => void; saving: boolean;
}) {
  return (
    <div className="w-72 shrink-0 border-l border-rule bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" /> Version history
        </div>
        <button onClick={onClose} className="hover:text-ink-muted p-0.5"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {versions.length === 0 && (
          <p className="text-xs text-ink-muted px-4 py-3">No history yet.</p>
        )}
        {versions.map((v) => (
          <div key={v.id} className={`px-4 py-3 border-b border-rule/50 ${v.isActive ? "bg-accent/5" : ""}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">Version {v.version}</span>
              {v.isActive ? (
                <span className="text-[10px] px-1.5 py-0.5 bg-accent text-paper rounded-full">Current</span>
              ) : (
                <button onClick={() => onRestore(v.id, v.version)} disabled={saving}
                  className="text-xs text-ink-muted hover:text-ink flex items-center gap-1 disabled:opacity-40">
                  <RotateCcw className="h-3 w-3" /> Restore
                </button>
              )}
            </div>
            <div className="text-xs text-ink-muted">{fmt(v.createdAt)}</div>
            {v.createdBy && <div className="text-xs text-ink-muted/60 truncate">{v.createdBy}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview + Preview sections                                                 */
/* -------------------------------------------------------------------------- */

function OverviewSection({ templates, onNavigate }: {
  templates: TemplatesState; onNavigate: (s: ActiveSection) => void;
}) {
  return (
    <div>
      <p className="text-sm text-ink-muted mb-6">Active rule sets for this brand. Click any card to edit.</p>
      <div className="grid grid-cols-3 gap-4">
        <button onClick={() => onNavigate("global")}
          className="text-left p-4 border border-rule rounded-md hover:border-accent/50 hover:bg-secondary/40 transition-colors">
          <div className="flex items-center gap-2 mb-2"><Globe className="h-4 w-4 text-accent" /><span className="text-sm font-semibold">Global rules</span></div>
          <div className="text-xs text-ink-muted space-y-0.5">
            {templates.global ? (
              <><div>v{templates.global.version} · {fmtShort(templates.global.created_at)}</div>
              <div>DR ≥ {(templates.global.template_data as { citation_authority?: { dr_minimum?: number } }).citation_authority?.dr_minimum ?? "—"}</div></>
            ) : <div className="text-ink-muted/50">No template yet</div>}
          </div>
        </button>
        {CONTENT_TYPES.map(({ key, label }) => {
          const t = templates.byType[key] ?? null;
          const d = t?.template_data as { article_structure?: { target_word_count?: number; section_kinds?: string[] } } | undefined;
          return (
            <button key={key} onClick={() => onNavigate(key)}
              className="text-left p-4 border border-rule rounded-md hover:border-accent/50 hover:bg-secondary/40 transition-colors">
              <div className="flex items-center gap-2 mb-2"><BookOpen className="h-4 w-4 text-ink-muted" /><span className="text-sm font-semibold">{label}</span></div>
              <div className="text-xs text-ink-muted space-y-0.5">
                {t ? (
                  <><div>v{t.version} · {fmtShort(t.created_at)}</div>
                  <div>{d?.article_structure?.target_word_count?.toLocaleString() ?? "—"}w · {d?.article_structure?.section_kinds?.length ?? "—"} sections</div></>
                ) : <div className="text-ink-muted/50">No template yet</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreviewSection({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<Record<string, ResolvedTemplate>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    Promise.all(
      CONTENT_TYPES.map(async ({ key }) => {
        const r = await fetch(`/api/admin/content-plan-templates/resolve?brandId=${brandId}&contentType=${key}`, { credentials: "include" });
        if (!r.ok) return null;
        return [key, await r.json()] as [string, ResolvedTemplate];
      })
    ).then((results) => {
      const map: Record<string, ResolvedTemplate> = {};
      for (const r of results) { if (r) map[r[0]] = r[1]; }
      setResolved(map);
    }).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  }, [brandId]);

  if (loading) return <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading resolved templates…</div>;
  if (error) return <div className="text-sm text-red-500">{error}</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Resolved values your plans will actually use — after applying all per-type overrides and global cascades.</p>
      {CONTENT_TYPES.map(({ key, label }) => {
        const r = resolved[key];
        if (!r) return <div key={key} className="p-3 border border-rule rounded text-xs text-ink-muted">{label}: No global template configured.</div>;
        return (
          <div key={key} className="p-4 border border-rule rounded-md">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</h4>
              <span className="text-[10px] text-ink-muted">global v{r.versions.global}{r.versions.perType !== null ? ` · type v${r.versions.perType}` : ""}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <span className="text-ink-muted">Word count:</span>
              <span>{r.articleStructure?.targetWordCount.toLocaleString() ?? "—"}</span>
              <span className="text-ink-muted">Sections:</span>
              <span className="truncate">{r.articleStructure?.sectionKinds.join(" → ") ?? "—"}</span>
              <span className="text-ink-muted">Mentions target / max:</span>
              <span>
                {r.brandVoice.mentionsPerArticleTarget}{" "}
                <span className={`text-[10px] ${r.provenance.mentionsPerArticleTarget === "per_type" ? "text-accent" : "text-ink-muted/60"}`}>
                  ({r.provenance.mentionsPerArticleTarget === "per_type" ? "override" : "global"})
                </span>
                {" / "}
                {r.brandVoice.mentionsPerArticleMax}{" "}
                <span className={`text-[10px] ${r.provenance.mentionsPerArticleMax === "per_type" ? "text-accent" : "text-ink-muted/60"}`}>
                  ({r.provenance.mentionsPerArticleMax === "per_type" ? "override" : "global"})
                </span>
              </span>
              <span className="text-ink-muted">DR minimum:</span>
              <span>
                ≥ {r.citationAuthority.drMinimum}{" "}
                <span className={`text-[10px] ${r.provenance.drMinimum === "per_type" ? "text-accent" : "text-ink-muted/60"}`}>
                  ({r.provenance.drMinimum === "per_type" ? "override" : "global"})
                </span>
              </span>
              {r.citationAuthority.whitelistedDomains.length > 0 && (
                <>
                  <span className="text-ink-muted">Domains:</span>
                  <span className="text-xs">{r.citationAuthority.whitelistedDomains.map(d => `${d.domain} (DR ${d.effectiveDrMinimum})`).join(", ")}</span>
                </>
              )}
              <span className="text-ink-muted">Links / citations:</span>
              <span>{r.requiredElements?.minInternalLinks ?? "—"} internal · {r.requiredElements?.minExternalCitations ?? "—"} external</span>
            </div>
          </div>
        );
      })}
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
  const [localDraft, setLocalDraft] = useState<GlobalData | TypeData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<VersionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  if (user && !user.isAdmin) return <Navigate to="/projects" replace />;

  const load = useCallback(async () => {
    if (!brandId) { setLoading(false); return; }
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/content-plan-templates?brandId=${brandId}`, { credentials: "include" });
      if (!resp.ok) throw new Error(await resp.text());
      setTemplates(await resp.json());
    } catch (e) { toast.error("Failed to load: " + (e as Error).message); }
    finally { setLoading(false); }
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const getBaseData = useCallback((): GlobalData | TypeData | null => {
    if (activeSection === "global") {
      const d = templates.global?.template_data as unknown as GlobalData | undefined;
      return d ?? defaultGlobal();
    }
    const isType = CONTENT_TYPES.some((ct) => ct.key === activeSection);
    if (isType) {
      const d = templates.byType[activeSection as ContentTypeKey]?.template_data as unknown as Partial<TypeData> | undefined;
      if (!d) return defaultTypeDataForType(activeSection as ContentTypeKey);
      return {
        article_structure: d.article_structure ?? { target_word_count: 2000, h2_count_target: 5, section_kinds: [] },
        required_elements: d.required_elements ?? { min_named_projects: 0, min_testimonials: 0, min_internal_links: 2, min_external_citations: 1 },
        brand_mention_overrides: d.brand_mention_overrides ?? { mentions_per_article_target: null, mentions_per_article_max: null },
        citation_authority_overrides: d.citation_authority_overrides ?? { dr_minimum: null, max_age_years: null, max_per_article: null, domain_min_dr: {} },
      };
    }
    return null;
  }, [activeSection, templates]);

  const switchSection = (s: ActiveSection) => {
    if (dirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    setActiveSection(s);
    setLocalDraft(null);
    setDirty(false);
    setShowHistory(false);
    setHistory([]);
  };

  const loadHistory = async () => {
    if (!brandId) return;
    setHistoryLoading(true);
    try {
      const isGlobal = activeSection === "global";
      const isType = CONTENT_TYPES.some((ct) => ct.key === activeSection);
      if (!isGlobal && !isType) return;
      const params = new URLSearchParams({ brandId, scope: isGlobal ? "global" : "content_type" });
      if (isType) params.set("contentType", activeSection);
      const resp = await fetch(`/api/admin/content-plan-templates/versions?${params}`, { credentials: "include" });
      if (!resp.ok) throw new Error(await resp.text());
      const { versions } = await resp.json();
      setHistory(versions);
      setShowHistory(true);
    } catch (e) { toast.error("Failed to load history: " + (e as Error).message); }
    finally { setHistoryLoading(false); }
  };

  const handleSave = async () => {
    if (!brandId) return;
    const data = localDraft ?? getBaseData();
    if (!data) return;
    setSaving(true);
    try {
      const isGlobal = activeSection === "global";
      const isType = CONTENT_TYPES.some((ct) => ct.key === activeSection);
      if (!isGlobal && !isType) return;
      const body = { brandId, scope: isGlobal ? "global" : "content_type", contentType: isGlobal ? null : activeSection, template_data: data };
      const resp = await fetch("/api/admin/content-plan-templates", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { template } = await resp.json();
      setTemplates((prev) => isGlobal
        ? { ...prev, global: template }
        : { ...prev, byType: { ...prev.byType, [activeSection]: template } });
      setDirty(false);
      setLocalDraft(null);
      if (showHistory) {
        setHistory((prev) => [{ ...template, isActive: true }, ...prev.map((v) => ({ ...v, isActive: false }))]);
      }
      toast.success(`Saved as version ${template.version}`);
    } catch (e) { toast.error("Save failed: " + (e as Error).message); }
    finally { setSaving(false); }
  };

  const handleRestore = async (templateId: string, version: number) => {
    if (!brandId) return;
    if (!window.confirm(`Restore version ${version}? This will create a new active version copied from v${version}.`)) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/content-plan-templates/rollback", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, templateId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const { template } = await resp.json();
      setTemplates((prev) => activeSection === "global"
        ? { ...prev, global: template }
        : { ...prev, byType: { ...prev.byType, [activeSection]: template } });
      setLocalDraft(null);
      setDirty(false);
      setHistory((prev) => [{ ...template, isActive: true }, ...prev.map((v) => ({ ...v, isActive: false }))]);
      toast.success(`Restored version ${version} as version ${template.version}`);
    } catch (e) { toast.error("Restore failed: " + (e as Error).message); }
    finally { setSaving(false); }
  };

  const handleDraftChange = (d: GlobalData | TypeData) => { setLocalDraft(d); setDirty(true); };

  const isEditable = activeSection === "global" || CONTENT_TYPES.some((ct) => ct.key === activeSection);
  const effectiveData = localDraft ?? getBaseData();

  const currentTemplate = activeSection === "global"
    ? templates.global
    : templates.byType[activeSection as ContentTypeKey] ?? null;

  const sectionLabel = activeSection === "overview" ? "Overview"
    : activeSection === "global" ? "Global rules"
    : activeSection === "preview" ? "Preview"
    : activeSection === "named-projects" ? "Named projects"
    : activeSection === "reviews-tagging" ? "Reviews bank tagging"
    : CONTENT_TYPES.find((ct) => ct.key === activeSection)?.label ?? activeSection;

  const globalData = templates.global?.template_data as unknown as GlobalData | null ?? null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-rule flex items-center gap-3 shrink-0">
        <Settings className="h-5 w-5 text-accent" />
        <h1 className="font-serif text-xl">Rules Dashboard</h1>
        <p className="text-sm text-ink-muted ml-2 hidden md:block">Configure content defaults per article type.</p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Inner sidebar */}
          <aside className="w-52 shrink-0 border-r border-rule bg-background overflow-y-auto py-2">
            <SidebarItem label="Overview" icon={<LayoutGrid className="h-4 w-4" />} active={activeSection === "overview"} onClick={() => switchSection("overview")} />
            <SidebarGroup label="Rules" />
            <SidebarItem label="Global rules" icon={<Globe className="h-4 w-4" />} active={activeSection === "global"} onClick={() => switchSection("global")} version={templates.global?.version} />
            <SidebarGroup label="By content type" />
            {CONTENT_TYPES.map(({ key, label }) => (
              <SidebarItem key={key} label={label} active={activeSection === key} onClick={() => switchSection(key)} version={templates.byType[key]?.version} />
            ))}
            <SidebarGroup label="Assets" />
            <SidebarItem label="Named projects" icon={<ExternalLink className="h-3 w-3 text-ink-muted/40" />} active={activeSection === "named-projects"} onClick={() => switchSection("named-projects")} />
            <SidebarItem label="Reviews bank tagging" icon={<ExternalLink className="h-3 w-3 text-ink-muted/40" />} active={activeSection === "reviews-tagging"} onClick={() => switchSection("reviews-tagging")} />
            <SidebarGroup label="Preview" />
            <SidebarItem label="Preview mode" active={activeSection === "preview"} onClick={() => switchSection("preview")} />
          </aside>

          {/* Main + optional history panel */}
          <div className="flex flex-1 overflow-hidden">
            <main className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-8 py-7">
                {/* Section header */}
                <div className="flex items-start justify-between mb-6 gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-ink">{sectionLabel}</h2>
                    {isEditable && (
                      <p className="text-xs text-ink-muted mt-0.5">
                        {currentTemplate
                          ? <>Version {currentTemplate.version} · saved {fmtShort(currentTemplate.created_at)}</>
                          : "No template yet — saving will create version 1"}
                        {dirty && <span className="ml-2 font-medium text-amber-600">· Unsaved changes</span>}
                      </p>
                    )}
                  </div>
                  {isEditable && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={loadHistory} disabled={historyLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-rule rounded text-xs hover:bg-secondary transition-colors disabled:opacity-40">
                        {historyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                        History
                      </button>
                      <button onClick={handleSave} disabled={saving || !dirty}
                        className="flex items-center gap-1.5 px-4 py-1.5 bg-ink text-paper text-sm rounded hover:bg-ink/80 disabled:opacity-40 transition-colors">
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save as new version
                      </button>
                    </div>
                  )}
                </div>

                {/* Section content */}
                {activeSection === "overview" && <OverviewSection templates={templates} onNavigate={switchSection} />}
                {activeSection === "global" && effectiveData && (
                  <GlobalForm data={effectiveData as GlobalData} onChange={handleDraftChange as (d: GlobalData) => void} />
                )}
                {CONTENT_TYPES.some((ct) => ct.key === activeSection) && effectiveData && (
                  <TypeForm
                    data={effectiveData as TypeData}
                    onChange={handleDraftChange as (d: TypeData) => void}
                    globalData={globalData}
                    contentType={activeSection as ContentTypeKey}
                    brandId={brandId ?? ""}
                  />
                )}
                {activeSection === "named-projects" && (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-muted">Manage named project case evidence — the portfolio the planner uses for project spotlights.</p>
                    <Link to="/admin/named-projects" className="inline-flex items-center gap-2 px-4 py-2 border border-rule rounded text-sm hover:bg-secondary transition-colors">
                      <ChevronRight className="h-4 w-4" /> Open Named Projects admin
                    </Link>
                    <p className="text-xs text-ink-muted">Full CRUD for named projects is available at the dedicated admin page (Phase 3).</p>
                  </div>
                )}
                {activeSection === "reviews-tagging" && (
                  <div className="space-y-4">
                    <p className="text-sm text-ink-muted">Tag reviews bank entries with industry and keyword tags for planner matching.</p>
                    <Link to="/admin/reviews-bank" className="inline-flex items-center gap-2 px-4 py-2 border border-rule rounded text-sm hover:bg-secondary transition-colors">
                      <ChevronRight className="h-4 w-4" /> Open Reviews Bank admin
                    </Link>
                    <p className="text-xs text-ink-muted">Tagging UI extensions arrive in Phase 3.</p>
                  </div>
                )}
                {activeSection === "preview" && brandId && <PreviewSection brandId={brandId} />}
              </div>
            </main>

            {showHistory && (
              <VersionHistoryPanel
                versions={history}
                onClose={() => setShowHistory(false)}
                onRestore={handleRestore}
                saving={saving}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarGroup({ label }: { label: string }) {
  return (
    <div className="px-3 pt-3 pb-0.5">
      <p className="text-[10px] uppercase tracking-widest text-ink-muted font-medium">{label}</p>
    </div>
  );
}

function SidebarItem({ label, icon, active, onClick, version }: {
  label: string; icon?: React.ReactNode; active: boolean;
  onClick: () => void; version?: number;
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
        active ? "bg-ink text-paper" : "text-ink hover:bg-secondary"
      }`}>
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {version !== undefined && !active && <span className="text-[10px] text-ink-muted shrink-0">v{version}</span>}
    </button>
  );
}
