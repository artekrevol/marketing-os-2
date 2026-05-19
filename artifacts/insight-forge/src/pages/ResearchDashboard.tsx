import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { ChevronDown, Star, Loader2, RefreshCw, ExternalLink, CheckCircle2, AlertCircle, HelpCircle, X, Circle, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Project, ProofPoint } from "@/lib/types";
import { DiscardProjectDialog } from "@/components/DiscardProjectDialog";
import { recordAudit } from "@/lib/audit";
import { emit } from "@/lib/events";
import { useActiveBrand } from "@/lib/brands";
import { aiClient } from "@/lib/ai-client";

type StageKey =
  | "search_intent"
  | "benchmark_teardown"
  | "competitor_teardown"
  | "synergy_map"
  | "angle_and_conversion"
  | "ai_citation_landscape"
  | "atomic_and_entities";

type SubStatus = Record<StageKey, { status: "pending" | "running" | "done" | "error"; error?: string | null; label?: string }>;

const STAGE_LABELS: Record<StageKey, string> = {
  search_intent: "Search intent",
  benchmark_teardown: "Benchmark teardown",
  competitor_teardown: "Competitor teardown",
  synergy_map: "Synergy map",
  angle_and_conversion: "Angle + proof points",
  ai_citation_landscape: "AI citation landscape",
  atomic_and_entities: "Atomic questions + entities",
};

const CORE_STAGES: StageKey[] = [
  "search_intent",
  "benchmark_teardown",
  "competitor_teardown",
  "synergy_map",
  "angle_and_conversion",
];

export default function ResearchDashboard() {
  const { project } = useOutletContext<{ project: Project }>();
  const nav = useNavigate();
  const [brief, setBrief] = useState<any>(null);
  const [proofs, setProofs] = useState<ProofPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({ c1: true, c2: true, c3: true, c4: true, c5: true, c6: true, c7: true, c8: true, c9: true, c10: true });
  const [advancing, setAdvancing] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // audit_log is admin-only insert by RLS, and project.delete is an
  // audit-required action, so the abort/discard control is gated to
  // admins. Writers should request a delete from an admin.
  const { isAdmin } = useActiveBrand();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [bResp, pResp] = await Promise.all([
        fetch(`/api/projects/${project.id}/research`, { credentials: "include" }),
        fetch(`/api/projects/${project.id}/proof-points`, { credentials: "include" }),
      ]);
      if (!mounted) return;
      setBrief(bResp.ok ? await bResp.json() : null);
      setProofs(pResp.ok ? await pResp.json() : []);
      setLoading(false);
    };
    void load();
    const timer = setInterval(() => { if (mounted) void load(); }, 8000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [project.id]);

  const abort = () => setDiscardOpen(true);

  const doDiscard = async () => {
    const justification = window.prompt(
      `Why are you deleting "${project.topic}"? (required for audit log)`,
    )?.trim();
    if (!justification) {
      toast.error("Justification is required to delete a project.");
      return;
    }
    setAborting(true);
    try {
      // Audit-first: if the audit write fails, abort the destructive mutation.
      const audit = await recordAudit(
        "project.delete",
        "project",
        project.id,
        justification,
        { topic: project.topic, status: project.status },
        project.brand_id ?? null,
      );
      if (!audit.ok) {
        toast.error("Audit log failed; deletion aborted: " + audit.error);
        setAborting(false);
        return;
      }
      const delResp = await fetch(`/api/projects/${project.id}`, { method: "DELETE", credentials: "include" });
      if (!delResp.ok) throw new Error(`HTTP ${delResp.status}`);
      emit("project.deleted", "project", project.id, { topic: project.topic }, project.brand_id ?? null);
      toast.success("Research aborted. Project deleted.");
      setDiscardOpen(false);
      nav("/new");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to abort";
      toast.error(msg);
      setAborting(false);
    }
  };

  const rerun = async () => {
    toast.info("Re-running research…");
    await aiClient.researchGenerate(project.id);
  };

  const star = async (pp: ProofPoint) => {
    await fetch(`/api/projects/${project.id}/proof-points/${pp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ starred: !pp.starred }),
    });
    setProofs((prev) => prev.map((p) => p.id === pp.id ? { ...p, starred: !pp.starred } : p));
  };

  const updateProof = async (id: string, patch: Partial<ProofPoint>) => {
    await fetch(`/api/projects/${project.id}/proof-points/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
  };

  const approve = async () => {
    setAdvancing(true);
    await fetch(`/api/projects/${project.id}/research/approve`, { method: "PATCH", credentials: "include" });
    const { error } = await aiClient.outlineGenerate(project.id);
    setAdvancing(false);
    if (error) {
      toast.error("Outline generation failed: " + error.message);
      return;
    }
    nav(`/project/${project.id}/outline`);
  };

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (loading) return <Center>Loading research…</Center>;

  const sub: SubStatus = (brief?.sub_status as SubStatus) || ({} as SubStatus);
  const stageList: StageKey[] = [
    "search_intent",
    "benchmark_teardown",
    "competitor_teardown",
    "synergy_map",
    "angle_and_conversion",
    "ai_citation_landscape",
    "atomic_and_entities",
  ];
  const doneCount = stageList.filter((k) => sub[k]?.status === "done").length;
  const errorCount = stageList.filter((k) => sub[k]?.status === "error").length;
  const pct = Math.round((doneCount / stageList.length) * 100);

  // The dashboard renders 10 cards but only 7 backend stages exist:
  //   angle_and_conversion  -> cards 05, 06, 07
  //   atomic_and_entities   -> cards 09, 10
  // Counter must reflect what the user sees (cards), not internal stages,
  // otherwise it tops out at "7/7" while 10 cards are visible — UX audit
  // flagged this as the "0/7 vs 10" mismatch.
  const CARD_TO_STAGE: StageKey[] = [
    "search_intent",        // 01
    "benchmark_teardown",   // 02
    "competitor_teardown",  // 03
    "synergy_map",          // 04
    "angle_and_conversion", // 05
    "angle_and_conversion", // 06
    "angle_and_conversion", // 07
    "ai_citation_landscape",// 08
    "atomic_and_entities",  // 09
    "atomic_and_entities",  // 10
  ];
  const cardTotal = CARD_TO_STAGE.length;
  const cardDone = CARD_TO_STAGE.filter((k) => sub[k]?.status === "done").length;
  const cardError = CARD_TO_STAGE.filter((k) => sub[k]?.status === "error").length;

  // Show the "in flight" splash only until the FIRST card lands.
  const anyDataYet = Boolean(
    brief?.search_intent || brief?.benchmark_teardown || brief?.competitor_teardown ||
    brief?.synergy_map || brief?.ai_citation_landscape || brief?.atomic_question_map ||
    brief?.angle_inventory,
  );

  const retryCard = async (stage: StageKey) => {
    toast.info(`Retrying ${STAGE_LABELS[stage]}…`);
    await aiClient.researchRetryCard(project.id, stage);
  };

  if (!anyDataYet) {
    return (
      <>
      <DiscardProjectDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={doDiscard}
        loading={aborting}
        topic={project.topic}
      />
      <div className="max-w-2xl mx-auto px-10 py-16">
        <div className="text-center mb-8">
          <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto mb-4" />
          <h2 className="font-serif text-2xl mb-2">Deep research in flight</h2>
          <p className="text-sm text-ink-muted">
            7 sub-stages running in parallel. First card usually lands in 10–20 seconds.
          </p>
        </div>

        <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-widest text-ink-muted">
          <span>{doneCount} of {stageList.length} complete</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1 w-full bg-rule rounded-sm overflow-hidden mb-8">
          <div className="h-full bg-accent transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>

        <ol className="space-y-2 mb-8">
          {stageList.map((k) => {
            const s = sub[k]?.status || "pending";
            return (
              <li key={k} className="flex items-center gap-3 text-sm">
                <StageIcon status={s} />
                <span className={s === "done" ? "text-ink-muted line-through" : s === "running" ? "text-ink font-medium" : s === "error" ? "text-destructive" : "text-ink-muted"}>
                  {STAGE_LABELS[k]}
                </span>
                {s === "error" && (
                  <button onClick={() => retryCard(k)} className="ml-auto text-xs text-accent hover:underline inline-flex items-center gap-1">
                    <RotateCw className="h-3 w-3" /> retry
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {brief?.progress_error && (
          <p className="text-xs text-destructive mb-4 text-center">Error: {brief.progress_error}</p>
        )}

        <p className="text-xs text-ink-muted text-center mb-6 italic">
          Crawling {project.company_domain} · Playbook v{project.playbook_version || "—"} loaded
        </p>

        <div className="flex items-center justify-center gap-4">
          <button onClick={rerun} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Re-trigger all
          </button>
          {isAdmin && (
            <>
              <span className="text-ink-muted">·</span>
              <button
                onClick={abort}
                disabled={aborting}
                className="text-xs text-destructive hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                title="Admin-only — deletion is audit-logged."
              >
                <X className="h-3 w-3" /> {aborting ? "Aborting…" : "Abort & edit project"}
              </button>
            </>
          )}
        </div>
      </div>
      </>
    );
  }

  const si = brief.search_intent || {};
  const bt = brief.benchmark_teardown || {};
  const ct = brief.competitor_teardown || {};
  const sm = brief.synergy_map || {};
  const ai = brief.angle_inventory || {};
  const cs = brief.conversion_signals || {};
  const acl = brief.ai_citation_landscape || {};
  const aqm: any[] = brief.atomic_question_map || [];
  const edr = brief.entity_data_requirements || {};

  const coreReady = CORE_STAGES.every((k) => sub[k]?.status === "done");

  return (
    <>
    <DiscardProjectDialog
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      onConfirm={doDiscard}
      loading={aborting}
      topic={project.topic}
    />
    <div className="max-w-4xl mx-auto px-10 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Stage 1 · Research brief</p>
          <p className="text-xs text-ink-muted mt-1">{cardDone}/{cardTotal} cards complete{cardError > 0 ? ` · ${cardError} failed` : ""}</p>
        </div>
        <button onClick={rerun} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3" /> Re-run all
        </button>
      </div>

      <div className="space-y-3">
        <Card title="01 — Search intent" k="c1" open={open} toggle={toggle} status={sub.search_intent} onRetry={() => retryCard("search_intent")}>
          <KV label="Reader goal" value={si.reader_goal} />
          <KV label="Awareness stage" value={si.awareness_stage} />
          <KV label="Required belief" value={si.required_belief} />
          {si.notes && <KV label="Notes" value={si.notes} />}
        </Card>

        <Card title="02 — Benchmark blog teardown" k="c2" open={open} toggle={toggle} status={sub.benchmark_teardown} onRetry={() => retryCard("benchmark_teardown")}>
          <KV label="Opening hook" value={bt.opening_hook} />
          <KV label="Voice signature" value={bt.voice_signature} />
          <List label="Structural moves" items={bt.structural_moves} />
          <List label="Proof techniques" items={bt.proof_techniques} />
          <List label="What to steal" items={bt.three_things_to_steal} />
          <List label="What to skip" items={bt.two_things_to_skip} />
          <List label="Cited passages" items={bt.cited_passages} mono />
        </Card>

        <Card title="03 — Competitor service page teardown" k="c3" open={open} toggle={toggle} status={sub.competitor_teardown} onRetry={() => retryCard("competitor_teardown")}>
          <KV label="Hero claim" value={ct.hero_claim} />
          <List label="Trust signals" items={ct.trust_signals} />
          <List label="Architecture" items={ct.architecture} />
          <KV label="Pricing transparency" value={ct.pricing_transparency} />
          <KV label="CTA strategy" value={ct.cta_strategy} />
          <List label="SEO moves" items={ct.seo_moves} />
          <List label="What they do well" items={ct.what_they_do_well} />
          <List label="What's exploitable" items={ct.whats_exploitable} accent />
        </Card>

        <Card title={`04 — ${project.company_domain} synergy map`} k="c4" open={open} toggle={toggle} status={sub.synergy_map} onRetry={() => retryCard("synergy_map")}>
          {sm.ownable_angle && (
            <div className="mb-4 p-4 bg-secondary border-l-2 border-accent">
              <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Ownable angle</p>
              <p className="text-sm leading-relaxed">{sm.ownable_angle}</p>
            </div>
          )}
          <div className="text-xs uppercase tracking-wider text-ink-muted mb-2">Existing assets</div>
          <ul className="space-y-1.5 mb-4">
            {toArray(sm.existing_assets).map((a: any, i: number) => {
              const obj = (a && typeof a === "object") ? a : { title: renderListItem(a) };
              const url = typeof obj.url === "string" ? obj.url : "";
              const title = toText(obj.title) || toText(obj.name) || url || "Untitled";
              const why = toText(obj.why);
              return (
                <li key={i} className="text-sm">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                      {title} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span>{title}</span>
                  )}
                  {why && <span className="text-ink-muted"> — {why}</span>}
                </li>
              );
            })}
          </ul>
          <List label="Proprietary data points" items={sm.proprietary_data_points} />
          <List label="Leadership POV" items={sm.leadership_pov} />
          <List label="Voice patterns" items={sm.voice_patterns} />
        </Card>

        <Card title="05 — Angle inventory" k="c5" open={open} toggle={toggle} status={sub.angle_and_conversion} onRetry={() => retryCard("angle_and_conversion")}>
          <div className="grid grid-cols-3 gap-4">
            <Column title="Overdone" tone="muted" items={ai.overdone} />
            <Column title="Open territory" tone="accent" items={ai.open_territory} />
            <Column title="Avoid entirely" tone="danger" items={ai.avoid_entirely} />
          </div>
        </Card>

        <Card title={`06 — Proof point bank (${proofs.length})`} k="c6" open={open} toggle={toggle} status={sub.angle_and_conversion} onRetry={() => retryCard("angle_and_conversion")}>
          <div className="text-xs text-ink-muted mb-3">Star the ones the writer should lock in for the draft.</div>
          <div className="space-y-2">
            {proofs.map((pp) => <ProofRow key={pp.id} pp={pp} onStar={star} onChange={updateProof} />)}
            {proofs.length === 0 && <p className="text-sm text-ink-muted italic">No proof points returned.</p>}
          </div>
        </Card>

        <Card title="07 — Conversion signal map" k="c7" open={open} toggle={toggle} status={sub.angle_and_conversion} onRetry={() => retryCard("angle_and_conversion")}>
          <KV label="What makes them act" value={cs.act_triggers} />
          <KV label="Belief to instill" value={cs.required_belief} />
          <KV label="Mid-article CTA" value={cs.mid_cta} mono />
          <KV label="Closing CTA" value={cs.closing_cta} mono />
          <List label="Discard list" items={cs.discard_list} />
        </Card>

        <Card title="08 — AI citation landscape" k="c8" open={open} toggle={toggle} status={sub.ai_citation_landscape} onRetry={() => retryCard("ai_citation_landscape")}>
          <List label="Sample buyer prompts (LLM queries)" items={acl.sample_buyer_prompts} />
          {Array.isArray(acl.top_cited_sources) && acl.top_cited_sources.length > 0 && (
            <div className="py-2.5 border-b border-rule/60">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">Currently cited by AI engines</div>
              <ul className="space-y-1.5">
                {toArray(acl.top_cited_sources).map((s: any, i: number) => {
                  const o = (s && typeof s === "object") ? s : { publisher: renderListItem(s) };
                  const url = typeof o.url === "string" ? o.url : "";
                  const publisher = toText(o.publisher) || url || "Source";
                  return (
                    <li key={i} className="text-sm">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                          {publisher} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span>{publisher}</span>
                      )}
                      {toText(o.kind) && <span className="text-[10px] uppercase tracking-widest ml-2 text-ink-muted">{toText(o.kind)}</span>}
                      {toText(o.why_cited) && <p className="text-xs text-ink-muted mt-0.5">{toText(o.why_cited)}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <List label="Citation gaps (where you can insert)" items={acl.citation_gaps} accent />
          {Array.isArray(acl.suggested_authority_sources) && acl.suggested_authority_sources.length > 0 && (
            <div className="py-2.5">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">Suggested authority sources</div>
              <ul className="space-y-1">
                {toArray(acl.suggested_authority_sources).map((s: any, i: number) => {
                  const o = (s && typeof s === "object") ? s : { publisher: renderListItem(s) };
                  const publisher = toText(o.publisher) || toText(o.name);
                  const why = toText(o.why);
                  return (
                    <li key={i} className="text-sm flex gap-2">
                      <span className="text-ink-muted">·</span>
                      <span><strong>{publisher}</strong>{why && <> — <span className="text-ink-muted">{why}</span></>}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>

        <Card title={`09 — Atomic question map (${aqm.length})`} k="c9" open={open} toggle={toggle} status={sub.atomic_and_entities} onRetry={() => retryCard("atomic_and_entities")}>
          <p className="text-xs text-ink-muted mb-3">Buyer questions to answer as standalone, liftable paragraphs LLMs can quote directly.</p>
          <ul className="space-y-2">
            {toArray(aqm).map((q: any, i: number) => {
              const o = (q && typeof q === "object") ? q : { question: renderListItem(q) };
              return (
                <li key={i} className="border border-rule rounded-sm p-3">
                  <p className="text-sm leading-snug">{toText(o.question)}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-ink-muted">
                    {o.liftable_paragraph && <span className="text-accent">liftable</span>}
                    {o.requires_citation && <span>cite required</span>}
                    {toText(o.suggested_location) && <span>· {toText(o.suggested_location)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="10 — Entity & data density requirements" k="c10" open={open} toggle={toggle} status={sub.atomic_and_entities} onRetry={() => retryCard("atomic_and_entities")}>
          {edr.minimum_named_entities && typeof edr.minimum_named_entities === "object" && (
            <div className="py-2.5 border-b border-rule/60">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">Minimum named entities</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {Object.entries(edr.minimum_named_entities).map(([k, v]) => (
                  <div key={k} className="border border-rule rounded-sm p-2">
                    <p className="text-[10px] uppercase tracking-widest text-ink-muted">{k.replace(/_/g, " ")}</p>
                    <p className="font-serif text-xl">{toText(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <KV label="Required authority citations" value={edr.required_authority_citations != null ? String(edr.required_authority_citations) : undefined} />
          <KV label="Originality threshold (proprietary data points)" value={edr.originality_threshold != null ? String(edr.originality_threshold) : undefined} />
          {toArray(edr.recommended_schema_types).length > 0 && (
            <div className="py-2.5">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">Recommended schema markup</div>
              <div className="flex flex-wrap gap-1.5">
                {toArray(edr.recommended_schema_types).map((t: any, i: number) => (
                  <span key={i} className="citation-pill font-mono">{renderListItem(t)}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-10 pt-6 border-t border-rule flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          {proofs.filter((p) => p.starred).length} of {proofs.length} proof points starred
        </p>
        <button
          onClick={approve}
          disabled={advancing || !coreReady}
          title={!coreReady ? "Wait for the core research cards to finish" : undefined}
          className="bg-ink text-paper px-5 py-2.5 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          {advancing ? "Building outline…" : coreReady ? "Approve research → outline" : `Waiting on ${CORE_STAGES.length - CORE_STAGES.filter((k) => sub[k]?.status === "done").length} card(s)…`}
        </button>
      </div>
    </div>
    </>
  );
}

function StageIcon({ status }: { status: "pending" | "running" | "done" | "error" }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-verified shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 text-accent animate-spin shrink-0" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  return <Circle className="h-4 w-4 text-ink-muted/40 shrink-0" />;
}

function Card({ title, k, open, toggle, children, status, onRetry }: any) {
  const isOpen = open[k];
  const s: "pending" | "running" | "done" | "error" | undefined = status?.status;
  return (
    <section className="notebook-card">
      <div className="w-full flex items-center gap-3 px-5 py-4">
        {s && <StageIcon status={s} />}
        <button onClick={() => toggle(k)} className="flex-1 flex items-center justify-between text-left">
          <h3 className="font-serif text-lg">{title}</h3>
          <ChevronDown className={`h-4 w-4 text-ink-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {s === "error" && onRetry && (
          <button onClick={onRetry} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
            <RotateCw className="h-3 w-3" /> retry
          </button>
        )}
      </div>
      {isOpen && (
        <div className="px-5 pb-5 pt-0 border-t border-rule">
          {s === "running" && (
            <div className="py-6 text-xs text-ink-muted flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
            </div>
          )}
          {s === "error" && (
            <div className="py-4 text-xs text-destructive">
              Failed: {status?.error || "unknown error"}
            </div>
          )}
          {s === "pending" && (
            <div className="py-6 text-xs text-ink-muted">Queued.</div>
          )}
          {(s === "done" || !s) && children}
        </div>
      )}
    </section>
  );
}

function KV({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  const text = toText(value);
  if (!text) return null;
  return (
    <div className="py-2.5 border-b border-rule/60 last:border-0">
      <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">{label}</div>
      <div className={`text-sm leading-relaxed ${mono ? "font-mono text-xs" : ""}`}>{text}</div>
    </div>
  );
}

function List({ label, items, mono, accent }: { label: string; items?: string[]; mono?: boolean; accent?: boolean }) {
  const arr = toArray(items);
  if (!arr.length) return null;
  return renderList({ label, items: arr, mono, accent });
}

function renderList({ label, items, mono, accent }: { label: string; items?: any[]; mono?: boolean; accent?: boolean }) {
  const arr = toArray(items);
  return (
    <div className="py-2.5 border-b border-rule/60 last:border-0">
      <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">{label}</div>
      <ul className={`space-y-1 ${accent ? "text-accent" : ""}`}>
        {arr.map((it, i) => (
          <li key={i} className={`text-sm leading-relaxed ${mono ? "font-mono text-xs" : ""} flex gap-2`}>
            <span className="text-ink-muted">·</span>
            <span>{renderListItem(it)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Coerce any value into an array for safe .map() rendering. */
function toArray(v: any): any[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return Object.values(v);
  return [v];
}

/** Coerce any value into a safe string for direct text rendering. */
function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(renderListItem).filter(Boolean).join(", ");
  if (typeof v === "object") return renderListItem(v);
  return String(v);
}

/** Coerce any value into a safe React child. Objects -> compact stringified preview. */
function renderListItem(it: any): string {
  if (it == null) return "";
  if (typeof it === "string") return it;
  if (typeof it === "number" || typeof it === "boolean") return String(it);
  // Common shapes Anthropic may return for "list" items
  if (typeof it === "object") {
    const o = it as Record<string, any>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.value === "string") return o.value;
    if (typeof o.label === "string") return o.label;
    if (typeof o.title === "string" && typeof o.description === "string") return `${o.title} — ${o.description}`;
    if (typeof o.title === "string") return o.title;
    if (typeof o.name === "string") return o.name;
    if (typeof o.quote === "string") return o.quote;
    try {
      return JSON.stringify(it);
    } catch {
      return String(it);
    }
  }
  return String(it);
}

function Column({ title, tone, items }: { title: string; tone: "muted" | "accent" | "danger"; items?: string[] }) {
  const color = tone === "accent" ? "text-accent" : tone === "danger" ? "text-destructive" : "text-ink-muted";
  const arr = toArray(items);
  return (
    <div>
      <h4 className={`text-xs uppercase tracking-widest mb-2 ${color}`}>{title}</h4>
      <ul className="space-y-1.5">
        {arr.map((it, i) => (
          <li key={i} className="text-sm leading-snug">{renderListItem(it)}</li>
        ))}
      </ul>
    </div>
  );
}

function ProofRow({ pp, onStar, onChange }: { pp: ProofPoint; onStar: (p: ProofPoint) => void; onChange: (id: string, p: any) => void }) {
  const VStatus =
    pp.verification_status === "verified" ? CheckCircle2 :
    pp.verification_status === "needs writer confirmation" ? HelpCircle :
    AlertCircle;
  const vColor =
    pp.verification_status === "verified" ? "text-verified" :
    pp.verification_status === "needs writer confirmation" ? "text-unverified" :
    "text-ink-muted";

  return (
    <div className={`p-3 border rounded-sm transition-colors ${pp.starred ? "border-accent bg-accent/5" : "border-rule"}`}>
      <div className="flex items-start gap-3">
        <button onClick={() => onStar(pp)} className="mt-0.5">
          <Star className={`h-4 w-4 ${pp.starred ? "fill-accent text-accent" : "text-ink-muted hover:text-accent"}`} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-relaxed">{pp.claim}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            {pp.source_publication && <span>{pp.source_publication}</span>}
            {pp.publication_date && <span>· {pp.publication_date}</span>}
            {pp.source_url && (
              <a href={pp.source_url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                source <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <select
              value={pp.verification_status}
              onChange={(e) => onChange(pp.id, { verification_status: e.target.value })}
              className="ml-auto bg-transparent border-0 text-xs cursor-pointer focus:outline-none"
            >
              <option value="verified">verified</option>
              <option value="unverified">unverified</option>
              <option value="needs writer confirmation">needs confirmation</option>
            </select>
            <VStatus className={`h-3.5 w-3.5 ${vColor}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="p-12 text-ink-muted text-sm">{children}</div>;
}