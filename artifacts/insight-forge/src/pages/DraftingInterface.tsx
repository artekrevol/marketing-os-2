import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, AlertTriangle, ChevronRight, ChevronLeft, MessageCircle, Zap, Database, FileCode, Keyboard, X, Wand2, StopCircle, Copy, EyeOff, Eye, Pencil, Check, Focus, Minimize2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import type { Project, OutlineSection } from "@/lib/types";
import { buildWhitelistHosts, citationStatus } from "@/lib/citationWhitelist";
import WritingMetrics from "@/components/WritingMetrics";
import SelectionToolbar, { type SelectionAction } from "@/components/SelectionToolbar";

// Render markdown-ish inline citations [text](url) as hover-able pills.
// URLs whose host isn't on the project's verified whitelist render with the
// `unverified` token + warning title so writers can spot hallucinated cites
// at a glance. Server-side enforcement in draft-section already strips most
// of these — this is the second layer for any that slip through or for
// drafts produced before enforcement was added.
function renderWithCitations(text: string, whitelist: Set<string>) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const status = citationStatus(m[2], whitelist);
    const cls =
      status === "verified"
        ? "stat-highlight"
        : "underline decoration-dotted decoration-unverified text-unverified hover:text-unverified/80";
    const title = status === "verified" ? m[2] : `Unverified source — not on the project whitelist: ${m[2]}`;
    parts.push(
      <a key={i++} href={m[2]} target="_blank" rel="noreferrer" className={cls} title={title}>
        {m[1]}
      </a>,
    );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function DraftingInterface() {
  const { project } = useOutletContext<{ project: Project }>();
  const nav = useNavigate();
  const [outline, setOutline] = useState<any>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [proofs, setProofs] = useState<any[]>([]);
  const [briefLandscape, setBriefLandscape] = useState<any>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [generating, setGenerating] = useState<string | null>(null);
  const [revisionInput, setRevisionInput] = useState("");
  const [stitching, setStitching] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  // Sprint 2 #3: voice-flag actions. We persist dismissals on the draft row
  // (jsonb array of phrase strings) so they survive reload + realtime updates.
  // `showDismissed` is per-session UI only — writers can re-reveal what they
  // hid without un-dismissing it permanently.
  const [showDismissed, setShowDismissed] = useState(false);
  const reviseRef = useRef<HTMLTextAreaElement | null>(null);
  // Sprint 2 #4: inline prose editing.
  // - editingSectionId: which section's prose is being edited inline (null = none).
  // - inlineDraft: the in-progress textarea value. Kept separate from
  //   activeDraft.content so realtime updates from sibling tabs don't clobber
  //   what the writer is typing.
  // - savingInline: blocks Save button + ⌘↵ from double-firing.
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState("");
  const [savingInline, setSavingInline] = useState(false);
  const inlineRef = useRef<HTMLTextAreaElement | null>(null);

  // Phase 3: background draft-all runner.
  // We invoke draft-section in parallel with a concurrency cap of 4 (per spec).
  // Rationale: 4 × ~6.5K cached playbook + per-section instructions ≈ 26–35K
  // input tokens at peak, well under Tier 3's 80K TPM. After the first call
  // in a project lands, the playbook + project-context blocks return as
  // cache_read_input_tokens (see _shared/playbook.ts), so steady-state peak
  // is even lower. bgInFlight = the set of section_ids currently being
  // drafted (so the sidebar can show spinners on all of them, not just one).
  const BG_CONCURRENCY = 4;
  const [bgRunning, setBgRunning] = useState(false);
  const [bgInFlight, setBgInFlight] = useState<Set<string>>(new Set());
  const [bgQueueTotal, setBgQueueTotal] = useState(0);
  const [bgQueueDone, setBgQueueDone] = useState(0);
  const bgCancelRef = useRef(false);

  // Focus mode hides the right rail (voice flags + writing metrics + AI
  // readiness) and widens the prose column so the writer can see one
  // section at full breath. Persisted in localStorage so it survives reloads.
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("contentforge.focusMode") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("contentforge.focusMode", focusMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [focusMode]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [o, d, p, b] = await Promise.all([
        supabase.from("outlines").select("*").eq("project_id", project.id).maybeSingle(),
        supabase.from("drafts").select("*").eq("project_id", project.id),
        supabase.from("proof_points").select("source_url").eq("project_id", project.id),
        supabase.from("research_briefs").select("ai_citation_landscape").eq("project_id", project.id).maybeSingle(),
      ]);
      if (!mounted) return;
      setOutline(o.data);
      setDrafts((d.data as any) || []);
      setProofs((p.data as any) || []);
      setBriefLandscape((b.data as any)?.ai_citation_landscape || null);
    };
    load();
    const ch = supabase
      .channel(`d-${project.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "drafts", filter: `project_id=eq.${project.id}` }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [project.id]);

  const sections: OutlineSection[] = outline?.sections || [];
  const active = sections[activeIdx];
  const draftFor = (id: string) => drafts.find((d) => d.section_id === id);

  // Memoized project citation whitelist — recomputed only when proofs/brief
  // /project URLs change. Used by renderWithCitations to flag hallucinated
  // URLs without removing them from the prose.
  const whitelistHosts = useMemo(
    () =>
      buildWhitelistHosts({
        proofs,
        briefLandscape,
        project: {
          company_domain: (project as any).company_domain,
        },
      }),
    [proofs, briefLandscape, project],
  );
  const activeDraft = active ? draftFor(active.id) : null;

  const generate = async (sectionId: string, instruction?: string) => {
    setGenerating(sectionId);
    const { data, error } = await supabase.functions.invoke("draft-section", {
      body: { project_id: project.id, section_id: sectionId, revision_instruction: instruction },
    });
    setGenerating(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((data as any)?.error) {
      toast.error((data as any).error);
      return;
    }
    if (instruction) toast.success("Section revised.");
    setRevisionInput("");
  };

  const approveSection = async (id?: string) => {
    const sid = id || active?.id;
    if (!sid) return;
    const d = draftFor(sid);
    if (!d) {
      toast.error("Draft this section before approving.");
      return;
    }
    await supabase.from("drafts").update({ approved: true }).eq("project_id", project.id).eq("section_id", sid);
    // Optimistically reflect approval locally so `allDone` flips immediately
    // even before the realtime channel re-fetches.
    setDrafts((prev) => prev.map((x) => (x.section_id === sid ? { ...x, approved: true } : x)));
    setReviseOpen(false);
    setRevisionInput("");
    if (activeIdx < sections.length - 1) {
      setActiveIdx(activeIdx + 1);
    } else {
      toast.success("All sections approved. Stitch the final draft below.");
    }
  };

  const goPrev = () => setActiveIdx((i) => Math.max(0, i - 1));
  const goNext = () => setActiveIdx((i) => Math.min(sections.length - 1, i + 1));

  // Sprint 2 #3: voice-flag actions.
  // - applyAlternative: routes through the same revision pipeline as the
  //   manual revise box. We send an instruction-only delta so the cached
  //   playbook + per-project blocks still hit; this matches the pattern in
  //   mem://features/draft-stage-3.
  // - dismissFlag / restoreFlag: write directly to drafts.dismissed_voice_flags.
  //   We optimistically update local state because the realtime channel
  //   round-trip can lag the click; the DB write is the source of truth on
  //   reload.
  const dismissedSet = useMemo(
    () => new Set<string>(Array.isArray(activeDraft?.dismissed_voice_flags) ? (activeDraft?.dismissed_voice_flags as string[]) : []),
    [activeDraft?.dismissed_voice_flags],
  );

  const applyAlternative = async (phrase: string, alternative: string) => {
    if (!active || !alternative) return;
    const instruction = `Replace the phrase "${phrase}" with "${alternative}". Do not change any other prose, citations, or structure.`;
    setReviseOpen(false);
    setRevisionInput("");
    await generate(active.id, instruction);
  };

  // Selection toolbar → AI revision. We save any in-progress inline edit
  // first (so the writer's manual changes don't get clobbered by the revision
  // round-trip), then route through the same draft-section pipeline as the
  // manual revise box.
  const handleSelectionAction = async (action: SelectionAction, selection: string) => {
    if (!active) return;
    // Abort if the section is mid-revision — concurrent generate calls race
    // and the latter completion overwrites the former (single `generating`
    // string toggle). Better to make the writer wait one beat.
    if (generating === active.id) {
      toast.error("Wait for the current revision to finish.");
      return;
    }
    if (editingSectionId === active.id && inlineDraft !== (activeDraft?.content || "")) {
      const saved = await saveInlineEdit();
      if (!saved) {
        // Save failed — do not run the AI revision against stale server
        // content; the user's unsaved edits would be silently clobbered.
        toast.error("Couldn't save your edits — AI assist cancelled.");
        return;
      }
    } else if (editingSectionId === active.id) {
      cancelInlineEditor();
    }
    toast.message(`AI is rewriting your selection (${action.label.toLowerCase()})…`);
    await generate(active.id, action.buildInstruction(selection));
  };

  const persistDismissed = async (next: string[]) => {
    if (!activeDraft) return;
    setDrafts((prev) =>
      prev.map((d) => (d.id === activeDraft.id ? { ...d, dismissed_voice_flags: next } : d)),
    );
    const { error } = await supabase
      .from("drafts")
      .update({ dismissed_voice_flags: next })
      .eq("id", activeDraft.id);
    if (error) toast.error("Couldn't save dismissal.");
  };

  const dismissFlag = (phrase: string) => {
    const cur = Array.isArray(activeDraft?.dismissed_voice_flags) ? (activeDraft?.dismissed_voice_flags as string[]) : [];
    if (cur.includes(phrase)) return;
    persistDismissed([...cur, phrase]);
  };

  const restoreFlag = (phrase: string) => {
    const cur = Array.isArray(activeDraft?.dismissed_voice_flags) ? (activeDraft?.dismissed_voice_flags as string[]) : [];
    persistDismissed(cur.filter((p) => p !== phrase));
  };

  const copyPhrase = async (phrase: string) => {
    try {
      await navigator.clipboard.writeText(phrase);
      toast.success("Phrase copied — ⌘F to find it in the draft.");
    } catch {
      toast.error("Clipboard blocked by browser.");
    }
  };

  // Sprint 2 #4: inline prose editing.
  // - openInlineEditor: snapshot the current content into the textarea state
  //   and focus it. We pin to a section_id (not just "open") so navigating
  //   away (J/K) implicitly closes the editor without saving — matches the
  //   existing reviseOpen reset on activeIdx change.
  // - cancelInlineEditor: discards the textarea buffer.
  // - saveInlineEdit: writes content + last_edited_by='human' + recomputed
  //   citation_count to drafts, then captures the diff to voice_library so
  //   future drafts can learn from human edits (mirrors the AI-revision
  //   capture in supabase/functions/draft-section). We do NOT bump
  //   revision_count — that field is reserved for AI revisions per the
  //   existing schema, and Stage-3 cost telemetry depends on it.
  // - We deliberately do NOT recompute voice_match_score / entity_density_score
  //   here. Those are Haiku outputs; faking them client-side would be worse
  //   than letting them go stale until the next AI revision.
  const openInlineEditor = () => {
    if (!active || !activeDraft) return;
    setEditingSectionId(active.id);
    setInlineDraft(activeDraft.content || "");
    setReviseOpen(false); // mutually exclusive with the AI revise box
    setTimeout(() => {
      inlineRef.current?.focus();
      // Drop caret at the end so click-to-edit feels like resuming, not selecting.
      const len = inlineRef.current?.value.length ?? 0;
      inlineRef.current?.setSelectionRange(len, len);
    }, 0);
  };

  const cancelInlineEditor = () => {
    setEditingSectionId(null);
    setInlineDraft("");
  };

  const saveInlineEdit = async (): Promise<boolean> => {
    if (!activeDraft || !active) return false;
    const next = inlineDraft;
    const prev = activeDraft.content || "";
    if (next === prev) {
      cancelInlineEditor();
      return true;
    }
    setSavingInline(true);
    // Recompute citation_count from markdown links so the sidebar metric
    // doesn't lie after a human deletes/adds [text](url) spans.
    const citationCount = (next.match(/\[[^\]]+\]\(https?:\/\/[^\)]+\)/g) || []).length;
    // Optimistic local update — keeps the UI snappy ahead of realtime.
    setDrafts((p) =>
      p.map((d) =>
        d.id === activeDraft.id
          ? { ...d, content: next, citation_count: citationCount, last_edited_by: "human", updated_at: new Date().toISOString() }
          : d,
      ),
    );
    const { error } = await supabase
      .from("drafts")
      .update({
        content: next,
        citation_count: citationCount,
        last_edited_by: "human",
      })
      .eq("id", activeDraft.id);
    if (error) {
      toast.error("Couldn't save edit — local copy preserved.");
      setSavingInline(false);
      return false;
    }
    // Capture for the voice library so Stage-3 drafts can learn the
    // writer's voice over time. Non-fatal if it fails.
    supabase
      .from("voice_library")
      .insert({
        project_id: project.id,
        original_ai_text: prev,
        edited_human_text: next,
        edit_type: "inline",
        writer_id: (project as any).writer_id || null,
      })
      .then(({ error: ve }) => {
        if (ve) console.error("voice_library insert failed", ve);
      });
    setSavingInline(false);
    setEditingSectionId(null);
    setInlineDraft("");
    toast.success("Edit saved.");
    return true;
  };

  const openRevise = () => {
    setReviseOpen(true);
    setTimeout(() => reviseRef.current?.focus(), 0);
  };

  // Global keyboard shortcuts for Stage 3.
  // - J / K: next / prev (ignored when typing in an input)
  // - R: focus revise textarea (ignored when typing)
  // - Cmd/Ctrl + Enter: approve current section (works from inside textarea)
  // - Cmd/Ctrl + K: open command palette (scaffold — opens cheat sheet for now)
  // - Esc: close any open textarea/modal
  // - ?: open cheat sheet
  useEffect(() => {
    if (project.mode === "interview") return;
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const typing =
        !!tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          (tgt as any).isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape") {
        if (cheatOpen) { setCheatOpen(false); e.preventDefault(); return; }
        if (editingSectionId) { cancelInlineEditor(); (tgt as HTMLElement)?.blur?.(); e.preventDefault(); return; }
        if (reviseOpen) { setReviseOpen(false); (tgt as HTMLElement)?.blur?.(); e.preventDefault(); return; }
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (editingSectionId && active) {
          saveInlineEdit();
        } else if (reviseOpen && revisionInput.trim() && active) {
          generate(active.id, revisionInput);
        } else if (active) {
          approveSection(active.id);
        }
        return;
      }
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCheatOpen(true);
        return;
      }
      if (typing) return;
      if (e.key === "j" || e.key === "J") { e.preventDefault(); goNext(); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); goPrev(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); openRevise(); }
      else if (e.key === "?") { e.preventDefault(); setCheatOpen(true); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.mode, activeIdx, sections.length, reviseOpen, cheatOpen, revisionInput, active?.id, drafts, editingSectionId, inlineDraft]);

  // Reset transient revise state when switching sections.
  useEffect(() => {
    setReviseOpen(false);
    setRevisionInput("");
    // Sprint 2 #4: discard any in-progress inline edit on nav. We mirror the
    // revise-box behavior (save explicitly or lose it) — auto-saving here
    // would conflict with the writer's mental model.
    setEditingSectionId(null);
    setInlineDraft("");
  }, [activeIdx]);

  const lastEditedLabel = useMemo(() => {
    if (!activeDraft?.updated_at) return null;
    const ms = Date.now() - new Date(activeDraft.updated_at).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hr ago`;
    const days = Math.round(h / 24);
    return `${days}d ago`;
  }, [activeDraft?.updated_at]);

  const stitch = async () => {
    setStitching(true);
    const { error } = await supabase.functions.invoke("final-stitch", { body: { project_id: project.id } });
    setStitching(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    nav(`/project/${project.id}/review`);
  };

  const completeCount = drafts.filter((d) => d.approved).length;
  const allDone = sections.length > 0 && completeCount === sections.length;
  const progressPct = sections.length ? Math.round((completeCount / sections.length) * 100) : 0;
  const draftedCount = drafts.length;
  const remainingToDraft = sections.filter((s) => !draftFor(s.id)).length;

  /**
   * Phase 3 — Background draft-all.
   * Drafts every section that does not yet have a row in `drafts`, with up
   * to BG_CONCURRENCY (4) jobs in flight at once. A small worker pool pulls
   * from a shared queue so we cap peak load without leaving slots idle.
   * Realtime keeps the sidebar in sync as each section completes.
   */
  const draftAllRemaining = async () => {
    if (bgRunning) return;
    const queue = sections.filter((s) => !draftFor(s.id));
    if (queue.length === 0) {
      toast.info("Every section already has a draft.");
      return;
    }
    bgCancelRef.current = false;
    setBgRunning(true);
    setBgQueueTotal(queue.length);
    setBgQueueDone(0);
    toast.success(`Drafting ${queue.length} section${queue.length === 1 ? "" : "s"} in the background (up to ${BG_CONCURRENCY} in parallel). You can keep reviewing.`);

    let failures = 0;
    let cursor = 0;

    const runOne = async (s: OutlineSection) => {
      setBgInFlight((prev) => {
        const next = new Set(prev);
        next.add(s.id);
        return next;
      });
      try {
        const { data, error } = await supabase.functions.invoke("draft-section", {
          body: { project_id: project.id, section_id: s.id },
        });
        if (error || (data as any)?.error) {
          failures++;
          console.error("[draft-all]", s.heading, error || (data as any)?.error);
        }
      } catch (e) {
        failures++;
        console.error("[draft-all] exception", s.heading, e);
      } finally {
        setBgInFlight((prev) => {
          const next = new Set(prev);
          next.delete(s.id);
          return next;
        });
        setBgQueueDone((n) => n + 1);
      }
    };

    const worker = async () => {
      while (!bgCancelRef.current) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        await runOne(queue[idx]);
      }
    };

    const pool = Math.min(BG_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: pool }, () => worker()));

    setBgInFlight(new Set());
    setBgRunning(false);
    if (bgCancelRef.current) {
      toast.info("Background drafting stopped (in-flight sections will finish).");
    } else if (failures > 0) {
      toast.error(`Background drafting finished with ${failures} failure${failures === 1 ? "" : "s"}. Retry those sections individually.`);
    } else {
      toast.success("All remaining sections drafted. Review and approve when ready.");
    }
  };

  const cancelDraftAll = () => {
    if (!bgRunning) return;
    bgCancelRef.current = true;
  };

  if (!outline) return <div className="p-12 text-ink-muted">Loading outline…</div>;

  if (project.mode === "interview") return <InterviewMode project={project} sections={sections} />;

  return (
    <div className="flex h-full">
      {/* Section list */}
      <aside className="w-60 shrink-0 border-r border-rule bg-background overflow-y-auto">
        <div className="px-4 py-3 border-b border-rule">
          <p className="text-[10px] uppercase tracking-widest text-ink-muted">Sections</p>
          <p className="text-[10px] text-ink-muted mt-1 italic">Progress shown above</p>
        </div>
        <nav className="p-2 space-y-px">
          {sections.map((s, i) => {
            const d = draftFor(s.id);
            const isBgCurrent = bgInFlight.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={`w-full text-left px-3 py-2 rounded-sm text-sm transition-colors ${
                  i === activeIdx ? "bg-secondary" : "hover:bg-secondary/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.heading}</span>
                  {isBgCurrent ? (
                    <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${d?.approved ? "bg-verified" : d ? "bg-unverified" : "bg-rule"}`} />
                  )}
                </div>
                <div className="text-[10px] text-ink-muted mt-0.5">{s.word_count}w · {s.level}</div>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main draft area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {allDone && (
          <div className="sticky top-0 z-10 px-6 py-3 border-b border-rule bg-accent/10 flex items-center justify-between gap-4">
            <p className="text-sm">
              <span className="font-medium text-accent">All {sections.length} sections approved.</span>{" "}
              <span className="text-ink-muted">Stitch the final draft and move to review.</span>
            </p>
            <button
              onClick={stitch}
              disabled={stitching}
              className="bg-ink text-paper px-5 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50 shrink-0"
            >
              {stitching ? "Stitching…" : "Stitch & send to review →"}
            </button>
          </div>
        )}
        {/* Sticky progress bar — single source of truth for project + section progress */}
        {active && (
          <div className="sticky top-0 z-[5] border-b border-rule bg-background">
            <div className="px-4 pt-2.5 pb-1 flex items-center gap-3 text-xs">
              <span className="text-ink font-medium">{completeCount}/{sections.length} approved</span>
              <span className="text-rule">·</span>
              <span className="text-ink-muted">Section {activeIdx + 1} of {sections.length}</span>
              <span className="text-rule">·</span>
              <span className="text-ink font-medium truncate max-w-[36ch]">{active.heading}</span>
              {lastEditedLabel && (
                <>
                  <span className="text-rule">·</span>
                  <span className="text-ink-muted">Last edited {lastEditedLabel}</span>
                </>
              )}
              <div className="ml-auto flex items-center gap-1">
                {remainingToDraft > 0 && !bgRunning && (
                  <button
                    onClick={draftAllRemaining}
                    title={`Draft the remaining ${remainingToDraft} section${remainingToDraft === 1 ? "" : "s"} in the background`}
                    className="text-[11px] px-2 py-1 mr-1 inline-flex items-center gap-1.5 border border-rule rounded-sm hover:bg-secondary text-ink"
                  >
                    <Wand2 className="h-3 w-3" /> Draft all ({remainingToDraft})
                  </button>
                )}
                {bgRunning && (
                  <div className="mr-1 inline-flex items-center gap-2 text-[11px] px-2 py-1 border border-accent/40 rounded-sm bg-accent/10 text-accent">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Drafting {bgQueueDone + 1}/{bgQueueTotal}</span>
                    <button
                      onClick={cancelDraftAll}
                      title="Stop background drafting"
                      className="hover:text-ink"
                    ><StopCircle className="h-3 w-3" /></button>
                  </div>
                )}
                <button
                  onClick={goPrev}
                  disabled={activeIdx === 0}
                  title="Previous section (K)"
                  className="p-1.5 hover:bg-secondary rounded-sm disabled:opacity-40"
                ><ChevronLeft className="h-4 w-4" /></button>
                <button
                  onClick={goNext}
                  disabled={activeIdx >= sections.length - 1}
                  title="Next section (J)"
                  className="p-1.5 hover:bg-secondary rounded-sm disabled:opacity-40"
                ><ChevronRight className="h-4 w-4" /></button>
                <button
                  onClick={() => setCheatOpen(true)}
                  title="Keyboard shortcuts (?)"
                  className="p-1.5 hover:bg-secondary rounded-sm ml-1"
                ><Keyboard className="h-4 w-4" /></button>
              </div>
            </div>
            <Progress value={progressPct} className="h-1 rounded-none bg-secondary" />
          </div>
        )}

        {!active ? (
          <div className="p-12 text-ink-muted">No sections.</div>
        ) : (
          <>
          <div className="flex-1 overflow-y-auto">
          <div className={`${focusMode ? "max-w-3xl" : "max-w-2xl"} mx-auto px-10 py-10 transition-[max-width] duration-200`}>
            <p className="text-[10px] uppercase tracking-widest text-ink-muted">{active.level} · {active.word_count} words</p>
            <h2 className="font-serif text-3xl mt-1 mb-2">{active.heading}</h2>
            <p className="text-sm text-ink-muted italic mb-8">{active.job}</p>

            {!activeDraft ? (
              <button
                onClick={() => generate(active.id)}
                disabled={generating === active.id}
                className="w-full py-12 border border-dashed border-rule rounded-sm text-sm text-ink-muted hover:text-ink hover:border-ink transition-colors flex flex-col items-center justify-center gap-2"
              >
                {generating === active.id ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                    <span>Drafting…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5 text-accent" />
                    <span>Draft this section</span>
                  </>
                )}
              </button>
            ) : (
              <article className="prose-content">
                {editingSectionId === active.id ? (
                  <div>
                    <textarea
                      ref={inlineRef}
                      value={inlineDraft}
                      onChange={(e) => setInlineDraft(e.target.value)}
                      className="w-full min-h-[400px] text-base leading-[1.8] text-ink font-serif bg-paper border border-accent rounded-sm p-4 focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y"
                      spellCheck
                      placeholder="Edit the prose directly. Markdown citations [text](url) are preserved."
                    />
                    <SelectionToolbar
                      textareaRef={inlineRef}
                      text={inlineDraft}
                      disabled={generating === active.id || savingInline}
                      onAction={handleSelectionAction}
                    />
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-muted">
                        Select any passage for AI assists · direct edits feed your voice library.
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={cancelInlineEditor}
                          className="px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary text-ink-muted"
                        >
                          Cancel (Esc)
                        </button>
                        <button
                          onClick={saveInlineEdit}
                          disabled={savingInline || inlineDraft === (activeDraft.content || "")}
                          className="px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {savingInline ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Save edit (⌘↵)
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={openInlineEditor}
                    title="Click to edit prose directly"
                    className="text-base leading-[1.8] text-ink whitespace-pre-wrap font-serif cursor-text rounded-sm -mx-2 px-2 py-1 hover:bg-secondary/40 transition-colors"
                  >
                    {renderWithCitations(activeDraft.content, whitelistHosts)}
                  </div>
                )}

                {editingSectionId !== active.id && (
                  <div className="mt-8 flex flex-wrap items-center gap-2">
                    <button
                      onClick={openInlineEditor}
                      className="text-xs px-3 py-1.5 border border-rule rounded-full hover:border-ink hover:bg-secondary transition-colors inline-flex items-center gap-1.5"
                    >
                      <Pencil className="h-3 w-3" /> Edit prose
                    </button>
                    <span className="text-rule">·</span>
                    {["swap opener", "tighten", "add detail", "sounds too AI"].map((chip) => (
                      <button
                        key={chip}
                        onClick={() => generate(active.id, chip)}
                        className="text-xs px-3 py-1.5 border border-rule rounded-full hover:border-ink hover:bg-secondary transition-colors"
                      >{chip}</button>
                    ))}
                  </div>
                )}

                {(activeDraft.review_questions || []).length > 0 && (
                  <div className="mt-8 notebook-card p-4 space-y-3">
                    <p className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5">
                      <MessageCircle className="h-3 w-3" /> Review questions
                    </p>
                    {(activeDraft.review_questions as any[]).map((q, i) => (
                      <div key={i}>
                        <p className="text-xs uppercase tracking-wider text-accent mb-0.5">{q.kind}</p>
                        <p className="text-sm">{q.question}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            )}
          </div>
          </div>

          {/* Sticky action footer */}
          <div className="border-t border-rule bg-background">
            {reviseOpen && activeDraft && (
              <div className="px-6 pt-4 pb-2 border-b border-rule bg-secondary/30">
                <textarea
                  ref={reviseRef}
                  value={revisionInput}
                  onChange={(e) => setRevisionInput(e.target.value)}
                  placeholder="Tell the AI what to change in this section. ⌘↵ to submit, Esc to cancel."
                  className="w-full p-3 text-sm border border-rule rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  rows={3}
                />
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    onClick={() => { setReviseOpen(false); setRevisionInput(""); }}
                    className="text-xs px-3 py-1.5 text-ink-muted hover:text-ink"
                  >Cancel</button>
                  <button
                    onClick={() => revisionInput && active && generate(active.id, revisionInput)}
                    disabled={!revisionInput.trim() || generating === active?.id}
                    className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {generating === active?.id ? (<><Loader2 className="h-3 w-3 animate-spin" /> Revising…</>) : "Submit revision (⌘↵)"}
                  </button>
                </div>
              </div>
            )}
            <div className="px-6 py-3 flex items-center gap-3">
              <StatusPill draft={activeDraft} generating={generating === active?.id} />
              {activeDraft?.last_edited_by === "human" && !activeDraft?.approved && (
                <span
                  className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-secondary text-ink inline-flex items-center gap-1.5"
                  title="This section has unapproved human edits since the last AI revision."
                >
                  <Pencil className="h-3 w-3" /> Human edit
                </span>
              )}
              <span className="text-xs text-ink-muted">
                Revision {activeDraft?.revision_count || 0} of unlimited
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setFocusMode((v) => !v)}
                  className={`text-xs px-3 py-1.5 border rounded-sm inline-flex items-center gap-1.5 transition-colors ${
                    focusMode
                      ? "border-accent text-accent bg-accent/10 hover:bg-accent/20"
                      : "border-rule hover:bg-secondary"
                  }`}
                  title={focusMode ? "Exit focus mode — show metrics & flags" : "Focus mode — hide right rail to write distraction-free"}
                >
                  {focusMode ? <Minimize2 className="h-3 w-3" /> : <Focus className="h-3 w-3" />}
                  {focusMode ? "Exit focus" : "Focus"}
                </button>
                <button
                  onClick={openRevise}
                  disabled={!activeDraft || generating === active?.id}
                  className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary disabled:opacity-50"
                  title="Revise (R)"
                >Revise <kbd className="ml-1 text-[10px] text-ink-muted">R</kbd></button>
                <button
                  onClick={() => approveSection()}
                  disabled={!activeDraft || activeDraft?.approved}
                  className="text-xs px-3 py-1.5 bg-ink text-paper rounded-sm hover:bg-accent disabled:opacity-50"
                  title="Approve & next (Cmd/Ctrl + Enter)"
                >
                  {activeDraft?.approved ? "Approved" : "Approve & next"} <kbd className="ml-1 text-[10px] opacity-70">⌘↵</kbd>
                </button>
              </div>
            </div>
          </div>
          </>
        )}

      </div>

      {cheatOpen && <CheatSheet onClose={() => setCheatOpen(false)} />}

      {/* Right rail — hidden in focus mode */}
      {!focusMode && (
      <aside className="w-72 shrink-0 border-l border-rule bg-background overflow-y-auto">
        {/* Live writing metrics — readability, length, jargon */}
        {activeDraft && (
          <WritingMetrics
            text={editingSectionId === active?.id ? inlineDraft : (activeDraft.content || "")}
            targetWords={active?.word_count}
          />
        )}
        {/* AI citation readiness for the active section */}
        {activeDraft && (
          <div className="px-4 py-3 border-b border-rule">
            <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2 flex items-center gap-1.5">
              <Zap className="h-3 w-3" /> AI citation readiness
            </p>
            <div className="grid grid-cols-4 gap-2 text-center">
              <Metric
                label="Score"
                value={activeDraft.ai_citation_readiness_score ?? "—"}
                tone={
                  activeDraft.ai_citation_readiness_score >= 70
                    ? "verified"
                    : activeDraft.ai_citation_readiness_score >= 40
                    ? "unverified"
                    : "danger"
                }
              />
              <Metric
                label="Atomic"
                value={`${activeDraft.atomic_chunks_count ?? 0}/${(active?.atomic_questions || []).length || 0}`}
              />
              <Metric
                label="Cites"
                value={`${activeDraft.citation_count ?? 0}/${(active?.required_citations || []).length || 0}`}
                tone={
                  (active?.required_citations || []).length === 0
                    ? undefined
                    : (activeDraft.citation_count ?? 0) >= (active?.required_citations || []).length
                    ? "verified"
                    : "unverified"
                }
              />
              <Metric
                label="Entity"
                value={activeDraft.entity_density_score ?? "—"}
              />
            </div>
            {!!(active?.required_entities || []).length && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5 flex items-center gap-1.5">
                  <Database className="h-3 w-3" /> Required entities
                </p>
                <div className="flex flex-wrap gap-1">
                  {(active.required_entities || []).map((e, i) => (
                    <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-secondary text-ink-muted">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!!((activeDraft.schema_markup_recommendations as any[]) || []).length && (
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5 flex items-center gap-1.5">
                  <FileCode className="h-3 w-3" /> Schema markup
                </p>
                <div className="flex flex-wrap gap-1">
                  {((activeDraft.schema_markup_recommendations as any[]) || []).map((s, i) => (
                    <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm bg-accent/10 text-accent border border-accent/30">
                      {s.type || s["@type"] || "schema"}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3 border-b border-rule">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> Voice flags
            </p>
            {dismissedSet.size > 0 && (
              <button
                onClick={() => setShowDismissed((v) => !v)}
                className="text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink inline-flex items-center gap-1"
              >
                {showDismissed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                {showDismissed ? "Hide" : "Show"} dismissed ({dismissedSet.size})
              </button>
            )}
          </div>
        </div>
        <div className="p-3 space-y-3">
          {(() => {
            const all = Array.isArray(activeDraft?.voice_flags) ? (activeDraft?.voice_flags as any[]) : [];
            const visible = all.filter((f) => showDismissed || !dismissedSet.has(f.phrase));
            if (all.length === 0) {
              return <p className="text-xs text-ink-muted italic px-1">No uncertainties flagged.</p>;
            }
            if (visible.length === 0) {
              return <p className="text-xs text-ink-muted italic px-1">All flags dismissed.</p>;
            }
            return visible.map((f, i) => {
              const isDismissed = dismissedSet.has(f.phrase);
              const isRevising = generating === active?.id;
              return (
                <div
                  key={`${f.phrase}-${i}`}
                  className={`border border-rule rounded-sm p-3 ${isDismissed ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug flex-1 min-w-0 break-words">"{f.phrase}"</p>
                    <button
                      onClick={() => copyPhrase(f.phrase)}
                      className="shrink-0 p-1 -mr-1 -mt-1 text-ink-muted hover:text-ink rounded-sm hover:bg-secondary"
                      title="Copy phrase (then ⌘F in the draft)"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-xs text-ink-muted mt-1">{f.reason}</p>
                  {f.alternative && (
                    <p className="text-xs text-accent mt-2">Alt: "{f.alternative}"</p>
                  )}
                  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-rule">
                    {f.alternative && !isDismissed && (
                      <button
                        onClick={() => applyAlternative(f.phrase, f.alternative)}
                        disabled={isRevising}
                        className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-1"
                        title="Submit a revision that swaps this phrase for the suggested alternative"
                      >
                        {isRevising ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                        Apply
                      </button>
                    )}
                    {isDismissed ? (
                      <button
                        onClick={() => restoreFlag(f.phrase)}
                        className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm text-ink-muted hover:bg-secondary"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => dismissFlag(f.phrase)}
                        className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm text-ink-muted hover:bg-secondary"
                        title="Hide this flag — Haiku is wrong, this phrase is intentional"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </aside>
      )}
    </div>
  );
}

function StatusPill({ draft, generating }: { draft: any; generating: boolean }) {
  if (generating) {
    return <span className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-accent/10 text-accent inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Revising…</span>;
  }
  if (!draft) {
    return <span className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-secondary text-ink-muted">Empty</span>;
  }
  if (draft.approved) {
    return <span className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-verified/10 text-verified">Approved</span>;
  }
  return <span className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-unverified/10 text-unverified">Drafted — pending review</span>;
}

function CheatSheet({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["J", "Next section"],
    ["K", "Previous section"],
    ["R", "Focus revise box"],
    ["Click prose", "Edit section directly"],
    ["⌘ / Ctrl + ↵", "Save inline edit · submit revision · or approve section"],
    ["⌘ / Ctrl + K", "Command palette"],
    ["Esc", "Cancel inline edit / close textarea / close modal"],
    ["?", "Show this cheat sheet"],
  ];
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-background border border-rule rounded-sm shadow-xl w-full max-w-md"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
          <p className="text-sm font-medium">Keyboard shortcuts</p>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-sm"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">{v}</span>
              <kbd className="font-mono text-xs px-2 py-0.5 border border-rule rounded-sm bg-secondary">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: any; tone?: string }) {
  const color =
    tone === "verified"
      ? "text-verified"
      : tone === "danger"
      ? "text-destructive"
      : tone === "unverified"
      ? "text-unverified"
      : "text-ink";
  return (
    <div className="border border-rule rounded-sm py-1.5">
      <p className={`text-base font-serif ${color}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-widest text-ink-muted">{label}</p>
    </div>
  );
}

function InterviewMode({ project, sections }: { project: Project; sections: OutlineSection[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [reaction, setReaction] = useState("");
  const [question, setQuestion] = useState("Loading first question…");
  const [loading, setLoading] = useState(true);
  const active = sections[activeIdx];

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    supabase.functions
      .invoke("interview-step", { body: { project_id: project.id, section_id: active.id, last_answer: null } })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else {
          setReaction("");
          setQuestion((data as any)?.next_question || "Tell me about this section.");
        }
        setLoading(false);
      });
    supabase.from("interview_answers").select("*").eq("project_id", project.id).eq("section_id", active.id).order("created_at").then(({ data }) => {
      setHistory((data as any) || []);
    });
  }, [activeIdx, active?.id, project.id]);

  const submitAnswer = async () => {
    if (!answer.trim() || !active) return;
    const a = answer;
    setAnswer("");
    setLoading(true);
    await supabase.from("interview_answers").insert({ project_id: project.id, section_id: active.id, question, answer: a });
    setHistory((h) => [...h, { question, answer: a }]);
    const { data } = await supabase.functions.invoke("interview-step", { body: { project_id: project.id, section_id: active.id, last_answer: a } });
    setReaction((data as any)?.reaction || "");
    setQuestion((data as any)?.next_question || "Anything else?");
    setLoading(false);
  };

  if (!active) return <div className="p-12 text-ink-muted">No sections.</div>;

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 border-r border-rule bg-background overflow-y-auto p-2">
        {sections.map((s, i) => (
          <button key={s.id} onClick={() => setActiveIdx(i)} className={`w-full text-left px-3 py-2 rounded-sm text-sm ${i === activeIdx ? "bg-secondary" : "hover:bg-secondary/60"}`}>
            {s.heading}
          </button>
        ))}
      </aside>
      <div className="flex-1 max-w-2xl mx-auto px-10 py-12 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-widest text-ink-muted">{active.heading}</p>
        {reaction && <p className="text-sm text-accent italic mt-2">{reaction}</p>}
        <h2 className="font-serif text-2xl mt-3 mb-6 leading-snug">{loading ? "…" : question}</h2>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Speak your answer…"
          className="w-full p-4 border border-rule rounded-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none text-base leading-relaxed"
          rows={6}
        />
        <button onClick={submitAnswer} disabled={loading || !answer.trim()} className="mt-3 bg-ink text-paper px-4 py-2 rounded-sm text-sm hover:bg-accent disabled:opacity-50">
          {loading ? "Thinking…" : "Submit & continue"}
        </button>
      </div>
      <aside className="w-72 shrink-0 border-l border-rule bg-background overflow-y-auto p-3">
        <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-3">From your earlier answers</p>
        <div className="space-y-3">
          {history.slice(-3).map((h, i) => (
            <div key={i} className="border border-rule rounded-sm p-3">
              <p className="text-xs text-ink-muted mb-1">{h.question}</p>
              <p className="text-sm">{h.answer}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}