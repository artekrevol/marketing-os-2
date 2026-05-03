import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { emit } from "@/lib/events";
import { useActiveBrand } from "@/lib/brands";

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be signed in.");
        setSubmitting(false);
        return;
      }
      // Sprint 1: new projects are written to whatever brand the user
      // has currently selected in the brand switcher. BrandProvider is
      // the single source of truth — it already enforces that admins can
      // see all brands and writers are restricted to their access list,
      // so we just trust activeBrand here. RLS provides the second
      // line of defense at the DB level.
      if (!activeBrand) {
        throw new Error(
          isAdmin
            ? "No brand selected. Pick one in the brand switcher first."
            : "No brand selected. Ask an admin to grant brand access.",
        );
      }
      const activeBrandId = activeBrand.id;
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          topic: cleanTopic,
          url: finalSlug ? `/blog/${finalSlug}` : null,
          user_notes: cleanNotes && cleanNotes.length > 0 ? cleanNotes : null,
          content_type: "blog",
          mode: "composition",
          status: "proposing_brief",
          current_stage: 0,
          created_by: user.id,
          brand_id: activeBrandId,
        })
        .select()
        .single();
      if (error) throw error;

      // Sprint 1: emit project.created to the events log.
      emit("project.created", "project", project.id, { topic: cleanTopic }, activeBrandId);

      // fire brief proposer (don't await — let user see Step 2 page with loading)
      supabase.functions.invoke("propose-brief", { body: { project_id: project.id } });

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
