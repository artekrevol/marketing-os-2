import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Download, Code2, Globe, RotateCcw, ExternalLink, Loader2, Copy, FileCode,
  CheckCircle2, Circle, AlertCircle, FileText, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { Project, ProofPoint, OutlineSection } from "@/lib/types";
import { buildWhitelistHosts, citationStatus } from "@/lib/citationWhitelist";
import { toMarkdown, toHtml, toPlainText, buildHtmlDocument } from "@/lib/exportRenderers";
import { buildExportSchemas, exportFilename, isoDate } from "@/lib/exportSchema";
import { emit } from "@/lib/events";

/**
 * Stage 4 — Final review & export.
 *
 * Gating model (Sprint 1):
 *   - Export is disabled until every section in `outline.sections` has a
 *     corresponding `drafts` row with `approved = true`.
 *   - When the gate flips to all-approved, we auto-invoke `final-stitch`
 *     ONCE so the writer doesn't have to push a button to see their article.
 *   - `auto-stitched` state is held in component memory (a per-load latch),
 *     so a manual re-stitch is still possible by toggling approve states or
 *     clicking the "Re-stitch" button below the ledger.
 *
 * Citation policy at export time mirrors `draft-section`'s server-side
 * filter: whitelisted host → keep link; everything else → keep anchor text,
 * drop URL. See `lib/exportRenderers.ts` for the exact transforms.
 */
export default function DraftReview() {
  const { project } = useOutletContext<{ project: Project }>();
  const [scores, setScores] = useState<any>(null);
  const [outline, setOutline] = useState<any>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [proofs, setProofs] = useState<ProofPoint[]>([]);
  const [allProofs, setAllProofs] = useState<Array<{ source_url: string | null }>>([]);
  const [briefLandscape, setBriefLandscape] = useState<any>(null);
  const [atomicQuestions, setAtomicQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stitching, setStitching] = useState(false);
  const [autoStitched, setAutoStitched] = useState(false);
  const [rightTab, setRightTab] = useState<"citations" | "schema">("citations");

  const sections: OutlineSection[] = (outline?.sections as OutlineSection[]) || [];

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [s, o, d, p, ap, b] = await Promise.all([
        supabase.from("draft_scores").select("*").eq("project_id", project.id).maybeSingle(),
        supabase.from("outlines").select("*").eq("project_id", project.id).maybeSingle(),
        supabase.from("drafts").select("*").eq("project_id", project.id),
        supabase.from("proof_points").select("*").eq("project_id", project.id).eq("starred", true),
        supabase.from("proof_points").select("source_url").eq("project_id", project.id),
        supabase
          .from("research_briefs")
          .select("ai_citation_landscape, atomic_question_map")
          .eq("project_id", project.id)
          .maybeSingle(),
      ]);
      if (!mounted) return;
      setScores(s.data);
      setOutline(o.data);
      setDrafts((d.data as any) || []);
      setProofs((p.data as any) || []);
      setAllProofs((ap.data as any) || []);
      setBriefLandscape((b.data as any)?.ai_citation_landscape || null);
      setAtomicQuestions(((b.data as any)?.atomic_question_map as any[]) || []);
      setLoading(false);
    };
    load();
    // Realtime: listen to BOTH draft_scores (for the stitched output) and
    // drafts (for the approval ledger). The ledger needs to update live so
    // a teammate approving a section in another tab unblocks the export.
    const ch = supabase
      .channel(`r-${project.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "draft_scores", filter: `project_id=eq.${project.id}` },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "drafts", filter: `project_id=eq.${project.id}` },
        load,
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [project.id]);

  // Approval ledger: every outline section paired with its draft row.
  const ledger = useMemo(() => {
    return sections.map((s) => {
      const d = drafts.find((x) => x.section_id === s.id);
      const state: "missing" | "drafted" | "approved" = d
        ? d.approved
          ? "approved"
          : "drafted"
        : "missing";
      return { section: s, draft: d, state };
    });
  }, [sections, drafts]);

  const approvedCount = ledger.filter((r) => r.state === "approved").length;
  const allApproved = sections.length > 0 && approvedCount === sections.length;

  // Auto-invoke final-stitch the first time the gate flips to all-approved
  // OR if the ledger is fully approved but no scores row exists yet (e.g.
  // user navigated directly here after approving the last section).
  useEffect(() => {
    if (loading || !allApproved || stitching || autoStitched) return;
    if (scores?.final_draft) {
      // Already stitched — nothing to do, but mark auto-stitched so a future
      // approve toggle doesn't re-trigger automatically (writer can use the
      // "Re-stitch" button instead).
      setAutoStitched(true);
      return;
    }
    void runStitch(/* silent */ true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, allApproved, autoStitched, scores?.final_draft]);

  const runStitch = async (silent = false) => {
    setStitching(true);
    setAutoStitched(true);
    const { error } = await supabase.functions.invoke("final-stitch", { body: { project_id: project.id } });
    setStitching(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    emit(
      "review.completed",
      "project",
      project.id,
      { auto: silent },
      project.brand_id ?? null,
    );
    if (!silent) toast.success("Final draft re-stitched.");
  };

  const sendBack = async () => {
    await supabase.from("projects").update({ current_stage: 3, status: "drafting" }).eq("id", project.id);
    emit("review.sent_back", "project", project.id, {}, project.brand_id ?? null);
    toast.success("Sent back to drafting.");
  };

  /**
   * Sprint 3 — hand off the approved draft to the SEO OS quality-gate.
   * Two-step flow:
   *   1. POST /api/quality-gate/start-from-draft → idempotently creates
   *      (or finds) a content_object pinned to this project's latest draft.
   *   2. POST /api/quality-gate/submit          → flips the row to
   *      'submitted' and enqueues the qa_run.
   * On success we navigate to the SEO OS review surface so the writer can
   * watch the automated checks land in real time.
   */
  const [submittingQg, setSubmittingQg] = useState(false);
  const submitForReview = async () => {
    if (!project.brand_id) {
      toast.error("Project has no brand assigned.");
      return;
    }
    setSubmittingQg(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const startRes = await fetch("/api/quality-gate/start-from-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ brandId: project.brand_id, projectId: project.id }),
      });
      if (!startRes.ok) {
        const err = (await startRes.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(err.message || err.error || `start-from-draft failed (${startRes.status})`);
      }
      const { contentObjectId } = (await startRes.json()) as { contentObjectId: string };

      const submitRes = await fetch("/api/quality-gate/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ brandId: project.brand_id, contentObjectId }),
      });
      if (!submitRes.ok) {
        const err = (await submitRes.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(err.message || err.error || `submit failed (${submitRes.status})`);
      }

      emit(
        "qualitygate.submitted",
        "content_object",
        contentObjectId,
        { project_id: project.id },
        project.brand_id ?? null,
      );
      toast.success("Submitted to SEO OS quality gate.");
      // Open the review surface in a new tab so the writer keeps the
      // ContentForge export view open as a reference.
      const seoOsUrl = `/seo-os/quality-gate/${contentObjectId}`;
      window.open(seoOsUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmittingQg(false);
    }
  };

  // ----- Empty / gating states ---------------------------------------------
  if (loading) return <div className="p-12 text-ink-muted">Loading review…</div>;

  if (!allApproved) {
    return (
      <ApprovalGate
        ledger={ledger}
        approvedCount={approvedCount}
        total={sections.length}
        sendBack={sendBack}
      />
    );
  }

  if (!scores?.final_draft) {
    return (
      <div className="max-w-xl mx-auto px-10 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto mb-4" />
        <p className="text-sm text-ink-muted">
          {stitching ? "Stitching the final draft…" : "Awaiting final stitch."}
        </p>
        {!stitching && (
          <button
            onClick={() => runStitch(false)}
            className="mt-4 text-xs px-3 py-2 border border-accent text-accent rounded-sm hover:bg-accent/10"
          >Stitch now</button>
        )}
      </div>
    );
  }

  // ----- Build whitelist + citation list (URL-deduped) ---------------------
  const allMatches = Array.from(
    scores.final_draft.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g) as any,
  ) as RegExpMatchArray[];
  const seenUrls = new Set<string>();
  const cites = allMatches.filter((m) => {
    if (seenUrls.has(m[2])) return false;
    seenUrls.add(m[2]);
    return true;
  });
  const whitelistHosts = buildWhitelistHosts({
    proofs: allProofs,
    briefLandscape,
    project: { company_domain: (project as any).company_domain },
  });

  // ----- Build export schemas (deterministic) ------------------------------
  const schemas = buildExportSchemas({
    stitched: scores.final_draft,
    outline,
    atomicQuestions,
    drafts,
    project: {
      topic: project.topic,
      url: project.url,
      company_domain: (project as any).company_domain,
      keyword: project.keyword,
    },
    wordCount: scores.word_count,
  });

  // ----- Export handlers ---------------------------------------------------
  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(toMarkdown(scores.final_draft, whitelistHosts));
    toast.success("Markdown copied. Paste into Google Docs, Notion, or your CMS.");
  };

  const downloadHtml = () => {
    const bodyHtml = toHtml(scores.final_draft, whitelistHosts);
    const html = buildHtmlDocument({
      title: outline?.h1 || project.topic,
      description: outline?.meta_description || "",
      bodyHtml,
      schemas: schemas.map((s) => s.jsonld),
    });
    download(exportFilename(project.topic, "html"), html, "text/html");
    toast.success("HTML downloaded with embedded JSON-LD.");
  };

  const copyPlainText = async () => {
    await navigator.clipboard.writeText(toPlainText(scores.final_draft, whitelistHosts));
    toast.success("Plain text copied.");
  };

  const copyAllSchemas = () => {
    const all = schemas
      .map((s) => `<script type="application/ld+json">\n${JSON.stringify(s.jsonld, null, 2)}\n</script>`)
      .join("\n");
    navigator.clipboard.writeText(all);
    toast.success(`Copied ${schemas.length} JSON-LD block${schemas.length === 1 ? "" : "s"}.`);
  };
  const copyOne = (jsonld: any) => {
    navigator.clipboard.writeText(JSON.stringify(jsonld, null, 2));
    toast.success("JSON-LD copied.");
  };

  // ----- Citation summary --------------------------------------------------
  const verifiedCount = cites.filter((c) => citationStatus(c[2], whitelistHosts) === "verified").length;
  const unverifiedCount = cites.length - verifiedCount;

  return (
    <div className="flex flex-col h-full">
      {/* Score bar */}
      <div className="px-8 py-4 border-b border-rule bg-background grid grid-cols-7 gap-4">
        <Score label="Voice match" value={scores.voice_match_score} suffix="" tone="accent" />
        <Score
          label="AI citation"
          value={scores.ai_citation_readiness_score}
          tone={scores.ai_citation_readiness_score >= 70 ? "verified" : scores.ai_citation_readiness_score >= 40 ? "unverified" : "danger"}
        />
        <Score label="Originality" value={scores.originality_score} suffix="%" tone={scores.originality_score >= 80 ? "verified" : "unverified"} />
        <Score label="Word count" value={scores.word_count} />
        <Score label="Banned phrases" value={scores.banned_phrase_count} tone={scores.banned_phrase_count > 0 ? "danger" : "verified"} />
        <Score label="Citation completeness" value={scores.citation_completeness} suffix="%" />
        <Score
          label="Atomic chunks"
          value={`${scores.atomic_chunks_count ?? 0}/${scores.atomic_questions_count ?? 0}`}
          tone={scores.atomic_questions_count && scores.atomic_chunks_count >= scores.atomic_questions_count ? "verified" : "unverified"}
        />
      </div>

      {/* Two-pane */}
      <div className="flex-1 flex min-h-0">
        <article className="flex-1 overflow-y-auto px-12 py-10 max-w-3xl">
          <pre className="font-serif text-base leading-[1.8] whitespace-pre-wrap text-ink">{scores.final_draft}</pre>
        </article>
        <aside className="w-96 shrink-0 border-l border-rule bg-background overflow-y-auto">
          <div className="border-b border-rule flex">
            <button
              onClick={() => setRightTab("citations")}
              className={`flex-1 px-4 py-3 text-[11px] uppercase tracking-widest transition-colors ${
                rightTab === "citations" ? "bg-secondary text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              Citations <span className="text-ink-muted">({cites.length})</span>
            </button>
            <button
              onClick={() => setRightTab("schema")}
              className={`flex-1 px-4 py-3 text-[11px] uppercase tracking-widest transition-colors border-l border-rule ${
                rightTab === "schema" ? "bg-secondary text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              JSON-LD <span className="text-ink-muted">({schemas.length})</span>
            </button>
          </div>

          {rightTab === "citations" && (
            <div className="p-3 space-y-2">
              {cites.length > 0 && (
                <div className="text-[11px] text-ink-muted px-1 pb-1 flex items-center gap-3">
                  <span><span className="text-verified">●</span> {verifiedCount} verified</span>
                  {unverifiedCount > 0 && (
                    <span><span className="text-unverified">●</span> {unverifiedCount} unverified (will be stripped on export)</span>
                  )}
                </div>
              )}
              {cites.map((c, i) => {
                const proof = proofs.find((p) => p.source_url === c[2]);
                const status = citationStatus(c[2], whitelistHosts);
                return (
                  <a
                    key={i}
                    href={c[2]}
                    target="_blank"
                    rel="noreferrer"
                    className={`block border rounded-sm p-3 transition-colors ${
                      status === "unverified"
                        ? "border-unverified/60 bg-unverified/5 hover:border-unverified"
                        : "border-rule hover:border-ink"
                    }`}
                    title={status === "unverified" ? "Not on the project's verified source whitelist — link will be removed on export" : c[2]}
                  >
                    <p className="text-sm font-medium leading-snug">{c[1]}</p>
                    <p className="text-xs text-ink-muted mt-1 truncate inline-flex items-center gap-1">
                      {c[2]} <ExternalLink className="h-3 w-3" />
                    </p>
                    {status === "unverified" && (
                      <span className="inline-block text-[10px] uppercase tracking-wider mt-2 text-unverified">
                        unverified — anchor kept, link stripped
                      </span>
                    )}
                    {proof && (
                      <span className={`inline-block text-[10px] uppercase tracking-wider mt-2 ml-2 ${
                        proof.verification_status === "verified" ? "text-verified" :
                        proof.verification_status === "needs writer confirmation" ? "text-unverified" : "text-ink-muted"
                      }`}>{proof.verification_status}</span>
                    )}
                  </a>
                );
              })}
              {cites.length === 0 && <p className="text-xs text-ink-muted italic px-1">No inline citations detected.</p>}
            </div>
          )}

          {rightTab === "schema" && (
            <div className="p-3 space-y-3">
              {schemas.length === 0 && (
                <p className="text-xs text-ink-muted italic px-1">No schema generated.</p>
              )}
              {schemas.length > 0 && (
                <button
                  onClick={copyAllSchemas}
                  className="w-full text-xs px-3 py-2 border border-accent text-accent rounded-sm hover:bg-accent/10 inline-flex items-center justify-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy all as &lt;script&gt; tags
                </button>
              )}
              {schemas.map((s, i) => (
                <div key={i} className="border border-rule rounded-sm">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-rule bg-secondary/40">
                    <span className="text-[11px] font-mono inline-flex items-center gap-1.5">
                      <FileCode className="h-3 w-3 text-accent" />
                      {s.type}
                    </span>
                    <button
                      onClick={() => copyOne(s.jsonld)}
                      className="text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink inline-flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" /> copy
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono leading-relaxed p-3 overflow-x-auto max-h-64 text-ink whitespace-pre">
{JSON.stringify(s.jsonld, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Action bar — three exports + send back */}
      <div className="px-8 py-4 border-t border-rule bg-background flex items-center gap-3">
        <button onClick={copyMarkdown} className="text-xs px-3 py-2 border border-rule rounded-sm hover:bg-secondary inline-flex items-center gap-1.5">
          <Copy className="h-3.5 w-3.5" /> Copy Markdown
        </button>
        <button onClick={downloadHtml} className="text-xs px-3 py-2 border border-accent text-accent rounded-sm hover:bg-accent/10 inline-flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> Download HTML + JSON-LD
        </button>
        <button onClick={copyPlainText} className="text-xs px-3 py-2 border border-rule rounded-sm hover:bg-secondary inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Copy Plain Text
        </button>
        <span className="text-[11px] text-ink-muted ml-2 font-mono">
          {exportFilename(project.topic, "html", new Date(scores.updated_at || Date.now()))}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => runStitch(false)}
            disabled={stitching}
            className="text-xs px-3 py-2 border border-rule rounded-sm hover:bg-secondary disabled:opacity-50 inline-flex items-center gap-1.5"
            title="Re-run final-stitch with current section content"
          >
            {stitching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />} Re-stitch
          </button>
          <button
            onClick={submitForReview}
            disabled={submittingQg}
            className="text-xs px-3 py-2 bg-accent text-accent-foreground rounded-sm hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            title="Hand the approved draft to SEO OS for automated checks + reviewer sign-off"
          >
            {submittingQg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Submit for review
          </button>
          <button onClick={sendBack} className="text-xs px-3 py-2 bg-ink text-paper rounded-sm hover:bg-accent inline-flex items-center gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Send back to draft
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Empty / blocking state shown until every section is approved.
 * Honest about what's missing — surfaces the exact rows that block export so
 * a writer doesn't have to bounce back to Stage 3 to find the gap.
 */
function ApprovalGate({
  ledger,
  approvedCount,
  total,
  sendBack,
}: {
  ledger: { section: OutlineSection; draft: any; state: "missing" | "drafted" | "approved" }[];
  approvedCount: number;
  total: number;
  sendBack: () => void;
}) {
  const remaining = total - approvedCount;
  return (
    <div className="max-w-2xl mx-auto px-10 py-12">
      <p className="text-[10px] uppercase tracking-widest text-ink-muted">Stage 4 · Export</p>
      <h2 className="font-serif text-2xl mt-1">Export is locked until every section is approved.</h2>
      <p className="text-sm text-ink-muted mt-2">
        {approvedCount}/{total} sections approved · {remaining} remaining. Updates here are live —
        approve sections in Stage 3 and the gate unlocks automatically.
      </p>

      <div className="mt-8 border border-rule rounded-sm divide-y divide-rule">
        {ledger.map((row, i) => (
          <div key={row.section.id} className="flex items-center gap-3 px-4 py-3">
            <span className="text-[10px] font-mono text-ink-muted w-6">{String(i + 1).padStart(2, "0")}</span>
            {row.state === "approved" && <CheckCircle2 className="h-4 w-4 text-verified shrink-0" />}
            {row.state === "drafted" && <AlertCircle className="h-4 w-4 text-unverified shrink-0" />}
            {row.state === "missing" && <Circle className="h-4 w-4 text-ink-muted shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{row.section.heading}</p>
              <p className="text-[10px] text-ink-muted">
                {row.state === "approved" && "Approved"}
                {row.state === "drafted" && "Drafted — needs approval"}
                {row.state === "missing" && "Not yet drafted"}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={sendBack}
          className="text-xs px-3 py-2 bg-ink text-paper rounded-sm hover:bg-accent inline-flex items-center gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Back to drafting
        </button>
        <span className="text-[11px] text-ink-muted">Or wait — this page updates as sections get approved.</span>
      </div>
    </div>
  );
}

function Score({ label, value, suffix, tone }: { label: string; value: any; suffix?: string; tone?: string }) {
  const color =
    tone === "verified" ? "text-verified" :
    tone === "danger" ? "text-destructive" :
    tone === "unverified" ? "text-unverified" :
    tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-ink-muted">{label}</p>
      <p className={`text-2xl font-serif mt-0.5 ${color}`}>{value ?? "—"}{value != null && suffix}</p>
    </div>
  );
}