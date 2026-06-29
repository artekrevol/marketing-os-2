import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, TrendingUp } from "lucide-react";
import { z } from "zod";
import { emit } from "@/lib/events";
import { useActiveBrand } from "@/lib/brands";
import { aiClient } from "@/lib/ai-client";
import { DataSourceTag } from "@workspace/ui-shared";
import {
  crossModule,
  type CrossLocation,
  type CrossResult,
  type KeywordContext,
} from "@/lib/cross-module";

const TOPIC_MAX = 200;
const NOTES_MAX = 4000;
const SLUG_MAX = 120;

const topicSchema = z
  .string()
  .trim()
  .min(1, "Topic is required.")
  .max(TOPIC_MAX, `Topic must be ${TOPIC_MAX} characters or fewer.`);

const projectSchema = z.object({
  topic: topicSchema,
  slug: z.string().trim().max(SLUG_MAX, `Slug must be ${SLUG_MAX} characters or fewer.`).optional(),
  notes: z.string().trim().max(NOTES_MAX, `Notes must be ${NOTES_MAX} characters or fewer.`).optional(),
});

const emptyCtx: KeywordContext = {
  volume: null,
  cpc: null,
  competition: null,
  currentRanking: null,
  currentUrl: null,
  topCompetitors: [],
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export default function NewProject() {
  const nav = useNavigate();
  const { activeBrand, isAdmin } = useActiveBrand();
  const [submitting, setSubmitting] = useState(false);
  const [topic, setTopic] = useState("");
  const [slug, setSlug] = useState("");
  const [notes, setNotes] = useState("");

  // --- SEO context (cross-module read into SEO OS) ---
  const [keyword, setKeyword] = useState("");
  const [locationId, setLocationId] = useState("");
  const [trackKeyword, setTrackKeyword] = useState(true);
  const [locations, setLocations] = useState<CrossLocation[]>([]);
  const [ctx, setCtx] = useState<CrossResult<KeywordContext> | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const ctxReq = useRef(0);

  const brandId = activeBrand?.id ?? null;

  // Load brand locations once a brand is active.
  useEffect(() => {
    if (!brandId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    crossModule
      .listLocations(brandId)
      .then((rows) => {
        if (cancelled) return;
        setLocations(rows);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  // Debounced cross-module lookup as the writer types the target keyword.
  useEffect(() => {
    const kw = keyword.trim();
    if (!brandId || kw.length < 2) {
      setCtx(null);
      setCtxLoading(false);
      return;
    }
    const reqId = ++ctxReq.current;
    setCtxLoading(true);
    const t = setTimeout(() => {
      crossModule
        .keywordContext(brandId, kw, locationId || undefined)
        .then((res) => {
          if (ctxReq.current !== reqId) return;
          setCtx(res);
        })
        .catch(() => {
          if (ctxReq.current !== reqId) return;
          setCtx({ data: emptyCtx, source: null, reason: "system-error" });
        })
        .finally(() => {
          if (ctxReq.current === reqId) setCtxLoading(false);
        });
    }, 450);
    return () => clearTimeout(t);
  }, [brandId, keyword, locationId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = projectSchema.safeParse({ topic, slug, notes });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message || "Invalid input.");
      return;
    }
    const { topic: cleanTopic, slug: cleanSlug, notes: cleanNotes } = parsed.data;
    setSubmitting(true);
    try {
      const finalSlug = (cleanSlug && cleanSlug.length > 0 ? cleanSlug : slugify(cleanTopic));
      if (!activeBrand) {
        throw new Error(
          isAdmin
            ? "No brand selected. Pick one in the brand switcher first."
            : "No brand selected. Ask an admin to grant brand access.",
        );
      }
      const cleanKeyword = keyword.trim();
      const body: Record<string, unknown> = {
        topic: cleanTopic,
        url: finalSlug ? `/blog/${finalSlug}` : null,
        user_notes: cleanNotes && cleanNotes.length > 0 ? cleanNotes : null,
        brand_id: activeBrand.id,
      };
      if (cleanKeyword) body["keyword"] = cleanKeyword;
      if (cleanKeyword && locationId) body["target_location_id"] = locationId;
      const resp = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const json = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) throw new Error(String(json["error"] ?? `HTTP ${resp.status}`));
      const project = json["project"] as { id: string } | undefined;
      if (!project?.id) throw new Error("Project created but no ID returned");

      // Cross-module write: optionally register the target keyword in SEO OS so
      // it gets tracked/crawled. Best-effort — never block project creation.
      if (trackKeyword && cleanKeyword && locationId) {
        try {
          await crossModule.trackKeyword({
            brandId: activeBrand.id,
            keywordText: cleanKeyword,
            locationId,
          });
        } catch {
          toast.message("Project created, but the keyword couldn’t be tracked in SEO OS.");
        }
      }

      // Sprint 1: emit project.created to the events log.
      emit("project.created", "project", project.id, { topic: cleanTopic }, activeBrand.id);

      // fire brief proposer (don't await — let user see Step 2 page with loading)
      void aiClient.proposeBrief(project.id);

      toast.success("Project created. Drafting your brief proposal…");
      nav(`/project/${project.id}/brief`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const topicLen = topic.length;
  const showCounter = topicLen >= TOPIC_MAX - 20;
  const overLimit = topicLen > TOPIC_MAX;

  return (
    <div className="max-w-2xl mx-auto px-10 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-3">Step 1 · Intake</p>
      <h1 className="font-serif text-4xl mb-3">What are we writing?</h1>
      <p className="text-sm text-ink-muted mb-10 max-w-lg">
        Just the topic. The assistant will read the company playbook and propose a full brief — keywords, ICP match, benchmarks,
        competitors — for you to review and edit.
      </p>

      <form onSubmit={submit} className="space-y-6">
        <Field
          label="Topic / blog title"
          required
          counter={
            showCounter
              ? { current: topicLen, max: TOPIC_MAX, over: overLimit }
              : undefined
          }
        >
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className={`${inp} ${overLimit ? "border-destructive focus:ring-destructive" : ""}`}
            placeholder="The future of agentic AI in fintech"
            autoFocus
          />
        </Field>

        <Field label="Target URL slug (optional)" hint={topic && !slug ? `auto: /blog/${slugify(topic)}` : undefined}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-muted font-mono">/blog/</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={inp}
              placeholder={topic ? slugify(topic) : "auto-generated from title"}
            />
          </div>
        </Field>

        <Field label="Notes for the AI (optional)" hint="Anything specific you want this piece to do or avoid">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inp} min-h-[120px] resize-y leading-relaxed`}
            placeholder="e.g. lean on our Series B announcement as proof, avoid mentioning Competitor X by name, target CTOs not founders…"
          />
        </Field>

        <div className="pt-2">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-1.5">
            SEO context (optional)
          </p>
          <p className="text-[11px] text-ink-muted mb-3">
            Set a target keyword to pull live search data from SEO OS and keep the two in sync.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className={inp}
              placeholder="Target keyword, e.g. agentic ai fintech"
            />
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={inp}
              disabled={locations.length === 0}
            >
              <option value="">
                {locations.length === 0 ? "No locations in SEO OS" : "Any location"}
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {keyword.trim().length >= 2 && (
            <div className="mt-3 border border-rule rounded-sm bg-background p-3">
              <KeywordContextPanel loading={ctxLoading} result={ctx} />
            </div>
          )}

          {keyword.trim().length >= 2 && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackKeyword}
                onChange={(e) => setTrackKeyword(e.target.checked)}
                disabled={!locationId}
                className="rounded border-rule"
              />
              <span className={!locationId ? "text-ink-muted" : ""}>
                Track this keyword in SEO OS
                {!locationId && " (pick a location first)"}
              </span>
            </label>
          )}
        </div>

        <div className="pt-4 border-t border-rule">
          <button
            type="submit"
            disabled={submitting}
            className="bg-ink text-paper px-5 py-2.5 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : "Propose research brief"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inp =
  "w-full px-3 py-2 bg-background border border-rule rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

/**
 * Renders the live SEO context for the typed target keyword. Follows the four
 * dispatch rules: never throws (reads return a typed envelope), shows explicit
 * empty states per `reason`, always attributes data via <DataSourceTag>, and
 * treats staleness as data (still shows numbers, tags them stale).
 */
function KeywordContextPanel({
  loading,
  result,
}: {
  loading: boolean;
  result: CrossResult<KeywordContext> | null;
}) {
  if (loading && !result) {
    return (
      <p className="text-xs text-ink-muted flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking SEO OS…
      </p>
    );
  }
  if (!result) return null;

  const { data, source, reason } = result;
  const header = (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[11px] uppercase tracking-wide text-ink-muted flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" /> Search data
      </span>
      <DataSourceTag source={source} reason={reason} />
    </div>
  );

  if (reason === "system-error") {
    return (
      <>
        {header}
        <p className="text-xs text-ink-muted">
          Couldn’t reach SEO OS right now. You can still create the project.
        </p>
      </>
    );
  }

  if (reason === "not-yet-tracked") {
    return (
      <>
        {header}
        <p className="text-xs text-ink-muted">
          This keyword isn’t tracked in SEO OS yet. Tick “Track this keyword” below to start
          collecting search volume and rankings.
        </p>
      </>
    );
  }

  const hasVolume = data.volume != null;
  const hasRanking = data.currentRanking != null;

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Metric label="Search volume" value={hasVolume ? data.volume!.toLocaleString() : "—"} />
        <Metric
          label="Current ranking"
          value={
            reason === "no-rankings" || !hasRanking ? "Not ranking yet" : `#${data.currentRanking}`
          }
        />
        <Metric
          label="Competition"
          value={data.competition != null ? data.competition.toFixed(2) : "—"}
        />
        <Metric label="CPC" value={data.cpc != null ? `$${data.cpc.toFixed(2)}` : "—"} />
      </div>

      {data.topCompetitors.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">Top competitors</p>
          <ul className="space-y-0.5">
            {data.topCompetitors.slice(0, 3).map((c) => (
              <li key={`${c.domain}-${c.position}`} className="text-xs text-ink-muted truncate">
                #{c.position} · {c.domain}
              </li>
            ))}
          </ul>
        </div>
      ) : reason === "no-competitors" ? (
        <p className="mt-3 text-xs text-ink-muted">No competitor data captured yet.</p>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="tabular-nums">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
  required,
  hint,
  counter,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  counter?: { current: number; max: number; over: boolean };
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-ink-muted mb-1.5 flex items-center justify-between">
        <span>
          {label} {required && <span className="text-accent">*</span>}
        </span>
        {counter && (
          <span
            className={`tabular-nums normal-case tracking-normal ${
              counter.over ? "text-destructive" : "text-ink-muted"
            }`}
          >
            {counter.current} / {counter.max}
          </span>
        )}
      </span>
      {children}
      {hint && <span className="text-[11px] text-ink-muted mt-1.5 block italic">{hint}</span>}
    </label>
  );
}
