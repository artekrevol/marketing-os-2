import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2,
  Star,
  ExternalLink,
  RefreshCw,
  X,
  Plus,
  Quote,
  MessageSquare,
  Database,
  Zap,
} from "lucide-react";
import type { Project, BriefProposal, KeywordEntry, Funnel, ContentType, Mode } from "@/lib/types";
import { DiscardProjectDialog } from "@/components/DiscardProjectDialog";
import { emit } from "@/lib/events";

const ICP_CATALOG = [
  { id: 1, label: "Founder / CEO" },
  { id: 2, label: "VP Engineering" },
  { id: 3, label: "Marketing lead" },
  { id: 4, label: "Product manager" },
];

export default function BriefProposalPage() {
  const { project } = useOutletContext<{ project: Project }>();
  const nav = useNavigate();
  const [loading, setLoading] = useState(!project.ai_proposed_brief);
  const [proposal, setProposal] = useState<BriefProposal | null>(
    (project.ai_proposed_brief as BriefProposal) || null,
  );
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState(6);
  const [briefError, setBriefError] = useState<string | null>(
    (project as any).brief_error || null,
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // Editable state — initialize from proposal, allow user to mutate
  const [keywords, setKeywords] = useState<KeywordEntry[]>([]);
  const [newKw, setNewKw] = useState("");
  const [funnel, setFunnel] = useState<Funnel>("MOFU");
  const [icps, setIcps] = useState<number[]>([]);
  const [pod, setPod] = useState("");
  const [benchmarkUrl, setBenchmarkUrl] = useState("");
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [contentType, setContentType] = useState<ContentType>("blog");
  const [mode, setMode] = useState<Mode>("composition");

  // Subscribe to project for proposal arrival
  useEffect(() => {
    const ch = supabase
      .channel(`brief-${project.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${project.id}` },
        (payload) => {
          const p = payload.new as Project & { brief_error?: string | null };
          if (p.ai_proposed_brief && !proposal) {
            setProposal(p.ai_proposed_brief as BriefProposal);
            setLoading(false);
            setBriefError(null);
          }
          if ((p as any).status === "brief_failed") {
            setBriefError(p.brief_error || "Brief generation failed. Please retry.");
            setLoading(false);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [project.id, proposal]);

  // Safety net: if we've been "loading" for more than 6 minutes with no proposal
  // and no surfaced error, show a soft error so the user isn't stuck forever.
  useEffect(() => {
    if (!loading || proposal || briefError) return;
    const t = setTimeout(() => {
      if (!proposal && !briefError) {
        setBriefError(
          "The brief proposer is taking longer than expected. The background job may have failed silently — try retrying.",
        );
        setLoading(false);
      }
    }, 6 * 60 * 1000);
    return () => clearTimeout(t);
  }, [loading, proposal, briefError]);

  const retryProposer = async () => {
    setBriefError(null);
    setLoading(true);
    setProgress(6);
    await supabase
      .from("projects")
      .update({ status: "brief_proposing", brief_error: null } as any)
      .eq("id", project.id);
    const { error } = await supabase.functions.invoke("propose-brief", {
      body: { project_id: project.id },
    });
    if (error) {
      setBriefError(error.message || "Failed to start proposer");
      setLoading(false);
    }
  };

  // Hydrate editable state once proposal arrives
  useEffect(() => {
    if (!proposal) return;
    setKeywords(proposal.keyword_cluster || []);
    setFunnel(proposal.funnel_stage || "MOFU");
    setIcps((proposal.icps || []).map((i) => i.id));
    setPod(proposal.pod || "");
    const benchTop = (proposal.benchmark_candidates || []).slice().sort((a, b) => a.rank - b.rank)[0];
    const compTop = (proposal.competitor_candidates || []).slice().sort((a, b) => a.rank - b.rank)[0];
    setBenchmarkUrl(benchTop?.url || "");
    setCompetitorUrl(compTop?.url || "");
    setContentType(proposal.content_type || "blog");
    setMode(proposal.mode || "composition");
    setLoading(false);
  }, [proposal]);

  // Asymptotic progress while waiting
  useEffect(() => {
    if (proposal) {
      setProgress(100);
      return;
    }
    setProgress(6);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setProgress(Math.min(94, 6 + 88 * (1 - Math.exp(-elapsed / 25))));
    }, 500);
    return () => clearInterval(id);
  }, [proposal]);

  const setPrimary = (kw: string) => {
    setKeywords((ks) => ks.map((k) => ({ ...k, is_primary: k.keyword === kw })));
  };
  const removeKw = (kw: string) => setKeywords((ks) => ks.filter((k) => k.keyword !== kw));
  const addKw = () => {
    const v = newKw.trim();
    if (!v) return;
    if (keywords.some((k) => k.keyword.toLowerCase() === v.toLowerCase())) return;
    setKeywords((ks) => [...ks, { keyword: v, competition: "medium", is_primary: ks.length === 0 }]);
    setNewKw("");
  };
  const toggleIcp = (id: number) =>
    setIcps((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const rerun = async () => {
    setProposal(null);
    setLoading(true);
    toast.info("Re-proposing brief…");
    await supabase.functions.invoke("propose-brief", { body: { project_id: project.id } });
  };

  const abort = () => setDiscardOpen(true);

  const doDiscard = async () => {
    setDiscarding(true);
    try {
      await supabase.from("projects").delete().eq("id", project.id);
      toast.success("Project discarded.");
      setDiscardOpen(false);
      nav("/new");
    } catch (e: any) {
      toast.error(e.message || "Failed to discard project");
      setDiscarding(false);
    }
  };

  const confirm = async () => {
    if (!keywords.length) {
      toast.error("Add at least one keyword.");
      return;
    }
    const primary = keywords.find((k) => k.is_primary) || keywords[0];
    if (!benchmarkUrl || !competitorUrl) {
      toast.error("Benchmark and competitor URLs are required.");
      return;
    }
    setConfirming(true);

    // Compute overrides relative to original proposal
    const original = proposal!;
    const overrides: Record<string, any> = {};
    if (primary.keyword !== (original.keyword_cluster || []).find((k) => k.is_primary)?.keyword)
      overrides.primary_keyword = primary.keyword;
    if (funnel !== original.funnel_stage) overrides.funnel_stage = funnel;
    if (JSON.stringify(icps.sort()) !== JSON.stringify((original.icps || []).map((i) => i.id).sort()))
      overrides.icps = icps;
    if (pod !== original.pod) overrides.pod = pod;
    const origBench = (original.benchmark_candidates || []).slice().sort((a, b) => a.rank - b.rank)[0]?.url;
    if (benchmarkUrl !== origBench) overrides.benchmark_url = benchmarkUrl;
    const origComp = (original.competitor_candidates || []).slice().sort((a, b) => a.rank - b.rank)[0]?.url;
    if (competitorUrl !== origComp) overrides.competitor_url = competitorUrl;
    if (contentType !== original.content_type) overrides.content_type = contentType;
    if (mode !== original.mode) overrides.mode = mode;

    const { error: upErr } = await supabase
      .from("projects")
      .update({
        keyword: primary.keyword,
        keyword_cluster: keywords as any,
        funnel_stage: funnel,
        icps,
        pod,
        benchmark_url: benchmarkUrl,
        competitor_url: competitorUrl,
        content_type: contentType,
        mode,
        user_overrides: overrides,
        brief_confirmed_at: new Date().toISOString(),
        status: "researching",
        current_stage: 1,
      })
      .eq("id", project.id);
    if (upErr) {
      toast.error(upErr.message);
      setConfirming(false);
      return;
    }

    emit(
      "brief.confirmed",
      "project",
      project.id,
      { keyword: primary.keyword, content_type: contentType, mode },
      project.brand_id ?? null,
    );

    // Kick off deep research
    supabase.functions.invoke("research-generate", { body: { project_id: project.id } });
    toast.success("Brief locked. Starting deep research…");
    nav(`/project/${project.id}/research`);
  };

  if (briefError && !proposal) {
    return (
      <>
      <DiscardProjectDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={doDiscard}
        loading={discarding}
        topic={project.topic}
      />
      <div className="max-w-2xl mx-auto px-10 py-20 text-center">
        <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-destructive/10 text-destructive mb-4">
          <X className="h-5 w-5" />
        </div>
        <h2 className="font-serif text-2xl mb-2">Brief generation failed</h2>
        <p className="text-sm text-ink-muted mb-2">
          The proposer didn't return a brief. Common causes: Anthropic timeout, rate limit, or web-search throttling.
        </p>
        <p className="text-[11px] font-mono text-destructive bg-destructive/5 border border-destructive/20 rounded-sm px-3 py-2 my-4 text-left whitespace-pre-wrap break-words">
          {briefError}
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={retryProposer}
            className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
          <button onClick={abort} className="text-xs text-destructive hover:underline inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Discard project
          </button>
        </div>
      </div>
      </>
    );
  }

  if (loading || !proposal) {
    return (
      <>
      <DiscardProjectDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={doDiscard}
        loading={discarding}
        topic={project.topic}
      />
      <div className="max-w-2xl mx-auto px-10 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto mb-4" />
        <h2 className="font-serif text-2xl mb-2">Drafting your brief proposal</h2>
        <p className="text-sm text-ink-muted mb-6">
          Reading the playbook and searching the live web for keywords, benchmarks, and SERP competitors.
        </p>
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-ink-muted">
          <span>Searching</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1 w-full bg-rule rounded-sm overflow-hidden">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-8 flex items-center justify-center gap-4">
          <button onClick={rerun} className="text-xs text-accent hover:underline inline-flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Re-trigger
          </button>
          <span className="text-ink-muted">·</span>
          <button onClick={abort} className="text-xs text-destructive hover:underline inline-flex items-center gap-1">
            <X className="h-3 w-3" /> Discard
          </button>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    <DiscardProjectDialog
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      onConfirm={doDiscard}
      loading={discarding}
      topic={project.topic}
    />
    <div className="max-w-4xl mx-auto px-10 py-10">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Step 2 · Proposed brief</p>
        <button onClick={rerun} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3" /> Re-propose
        </button>
      </div>
      <h2 className="font-serif text-3xl mb-2">Review &amp; edit before deep research</h2>
      <p className="text-sm text-ink-muted mb-8">
        Every field is editable. Star a different primary keyword, swap a benchmark, override the pod — nothing is locked.
      </p>

      <div className="space-y-6">
        {/* A. KEYWORD CLUSTER */}
        <Section title="A · Keyword cluster" subtitle="Live SERP search. Star your preferred primary keyword.">
          <div className="space-y-1.5">
            {keywords.map((k) => (
              <div
                key={k.keyword}
                className={`flex items-center gap-3 px-3 py-2.5 border rounded-sm text-sm ${
                  k.is_primary ? "border-accent bg-accent/5" : "border-rule"
                }`}
              >
                <button onClick={() => setPrimary(k.keyword)} title="Set as primary">
                  <Star className={`h-4 w-4 ${k.is_primary ? "fill-accent text-accent" : "text-ink-muted hover:text-accent"}`} />
                </button>
                <span className="flex-1 truncate">{k.keyword}</span>
                <span className="text-xs text-ink-muted font-mono whitespace-nowrap">
                  {k.estimated_monthly_volume != null
                    ? `${k.estimated_monthly_volume.toLocaleString()}/mo${k.volume_is_estimated ? "*" : ""}`
                    : "—"}
                </span>
                <CompetitionPill level={k.competition} />
                <button onClick={() => removeKw(k.keyword)} className="text-ink-muted hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newKw}
              onChange={(e) => setNewKw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKw())}
              placeholder="Add a custom keyword"
              className="flex-1 px-3 py-2 bg-background border border-rule rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button onClick={addKw} className="px-3 py-2 border border-rule rounded-sm text-xs hover:bg-secondary inline-flex items-center gap-1">
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          {proposal.primary_keyword_reasoning && (
            <Reasoning text={proposal.primary_keyword_reasoning} label="Why this primary" />
          )}
          <p className="text-[10px] text-ink-muted mt-2 italic">* volume is estimated</p>
        </Section>

        {/* B. INTENT & FUNNEL */}
        <Section title="B · Search intent & funnel stage" subtitle={proposal.funnel_reasoning}>
          <div className="flex gap-2">
            {(["TOFU", "MOFU", "BOFU"] as Funnel[]).map((f) => (
              <button
                key={f}
                onClick={() => setFunnel(f)}
                className={`px-3 py-1.5 rounded-sm text-xs border ${
                  funnel === f ? "bg-ink text-paper border-ink" : "border-rule hover:border-ink"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </Section>

        {/* C. ICP MATCH */}
        <Section title="C · ICP match" subtitle="Cited from the playbook">
          <div className="space-y-2">
            {(proposal.icps || []).map((i) => (
              <div
                key={i.id}
                className={`p-3 border rounded-sm cursor-pointer ${
                  icps.includes(i.id) ? "border-accent bg-accent/5" : "border-rule hover:border-ink"
                }`}
                onClick={() => toggleIcp(i.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {i.id}. {i.label}
                  </span>
                  <span className={`text-[10px] uppercase tracking-widest ${icps.includes(i.id) ? "text-accent" : "text-ink-muted"}`}>
                    {icps.includes(i.id) ? "selected" : "click to add"}
                  </span>
                </div>
                {i.playbook_citation && (
                  <p className="mt-1.5 text-xs text-ink-muted italic flex gap-1.5">
                    <Quote className="h-3 w-3 mt-0.5 shrink-0" /> {i.playbook_citation}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-[10px] uppercase tracking-widest text-ink-muted self-center">other:</span>
            {ICP_CATALOG.filter((c) => !(proposal.icps || []).some((p) => p.id === c.id)).map((c) => (
              <button
                key={c.id}
                onClick={() => toggleIcp(c.id)}
                className={`px-2.5 py-1 rounded-sm text-xs border ${
                  icps.includes(c.id) ? "bg-ink text-paper border-ink" : "border-rule hover:border-ink"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Section>

        {/* D. POD */}
        <Section title="D · Pod assignment" subtitle={proposal.pod_reasoning}>
          <input
            value={pod}
            onChange={(e) => setPod(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-rule rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Section>

        {/* E. BENCHMARK */}
        <Section title="E · Benchmark blog candidates" subtitle="Editorial standards to emulate. Pick one, or paste your own.">
          <CandidateList
            candidates={proposal.benchmark_candidates || []}
            selectedUrl={benchmarkUrl}
            onSelect={setBenchmarkUrl}
          />
          <UrlOverride value={benchmarkUrl} onChange={setBenchmarkUrl} placeholder="https://… (paste to override)" />
        </Section>

        {/* F. COMPETITOR */}
        <Section title="F · Competitor candidates" subtitle="Top live SERP results for the primary keyword.">
          <CandidateList
            candidates={(proposal.competitor_candidates || []).map((c) => ({
              ...c,
              publisher: c.publisher || (c.serp_position ? `SERP #${c.serp_position}` : ""),
            }))}
            selectedUrl={competitorUrl}
            onSelect={setCompetitorUrl}
          />
          <UrlOverride value={competitorUrl} onChange={setCompetitorUrl} placeholder="https://… (paste to override)" />
        </Section>

        {/* G. CONTENT TYPE & MODE */}
        <Section title="G · Content type & mode" subtitle={proposal.mode_reasoning}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-ink-muted mb-1 block">Type</span>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as ContentType)}
                className="w-full px-3 py-2 bg-background border border-rule rounded-sm text-sm"
              >
                <option value="blog">Blog post</option>
                <option value="landing">Landing page</option>
                <option value="service">Service page</option>
                <option value="case_study">Case study</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-ink-muted mb-1 block">Mode</span>
              <div
                className="w-full px-3 py-2 bg-muted/40 border border-rule rounded-sm text-sm text-ink-muted"
                title="Interview mode is on the Q3 roadmap. All projects currently run in composition mode."
              >
                Composition (data-driven)
              </div>
            </label>
          </div>
        </Section>

        {/* H. AI CITATION LANDSCAPE */}
        {proposal.ai_citation_landscape && (
          <Section
            title="H · AI citation landscape"
            subtitle="How LLMs (ChatGPT, Claude, Perplexity, Gemini, AI Overviews) currently surface this topic."
          >
            <div className="space-y-5">
              {!!proposal.ai_citation_landscape.sample_buyer_prompts?.length && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2 flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3" /> Sample buyer prompts
                  </p>
                  <ul className="space-y-1.5">
                    {proposal.ai_citation_landscape.sample_buyer_prompts.map((p, i) => (
                      <li key={i} className="text-sm border-l-2 border-rule pl-3 py-0.5 italic">
                        "{p}"
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!!proposal.ai_citation_landscape.top_cited_sources?.length && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">
                    Top cited sources today
                  </p>
                  <div className="space-y-1.5">
                    {proposal.ai_citation_landscape.top_cited_sources.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm border border-rule rounded-sm p-2.5">
                        <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-secondary text-ink-muted shrink-0">
                          {s.kind}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{s.publisher}</span>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent text-xs hover:underline inline-flex items-center gap-1 shrink-0"
                            >
                              open <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                          <p className="text-xs text-ink-muted mt-0.5">{s.why_cited}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!proposal.ai_citation_landscape.citation_gaps?.length && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">
                    Citation gaps to exploit
                  </p>
                  <ul className="space-y-1">
                    {proposal.ai_citation_landscape.citation_gaps.map((g, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-accent">→</span>
                        <span>{g}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!!proposal.ai_citation_landscape.suggested_authority_sources?.length && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">
                    Authorities to cite
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {proposal.ai_citation_landscape.suggested_authority_sources.map((a, i) => (
                      <div
                        key={i}
                        title={a.why}
                        className="text-xs border border-rule rounded-sm px-2.5 py-1.5"
                      >
                        <span className="font-medium">{a.publisher}</span>
                        {a.url_or_topic && <span className="text-ink-muted"> · {a.url_or_topic}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* I. ATOMIC QUESTION MAP */}
        {!!proposal.atomic_question_map?.length && (
          <Section
            title="I · Atomic question map"
            subtitle="Liftable, citation-ready paragraphs LLMs can quote verbatim."
          >
            <div className="space-y-1.5">
              {proposal.atomic_question_map.map((q, i) => (
                <div key={i} className="flex items-start gap-3 border border-rule rounded-sm p-2.5">
                  <Zap className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${q.liftable_paragraph ? "text-accent" : "text-ink-muted"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{q.question}</p>
                    <p className="text-[10px] uppercase tracking-widest text-ink-muted mt-1">
                      {q.suggested_location}
                      {q.requires_citation && <span className="text-accent"> · needs citation</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* J. ENTITY DATA REQUIREMENTS */}
        {proposal.entity_data_requirements && (
          <Section
            title="J · Entity & data requirements"
            subtitle="Minimum named entities and originality thresholds for AI citation."
          >
            <div className="space-y-4">
              {proposal.entity_data_requirements.minimum_named_entities && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2 flex items-center gap-1.5">
                    <Database className="h-3 w-3" /> Minimum named entities
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(proposal.entity_data_requirements.minimum_named_entities).map(([k, v]) => (
                      <div key={k} className="border border-rule rounded-sm p-2.5">
                        <p className="text-2xl font-serif">{v}</p>
                        <p className="text-[10px] uppercase tracking-widest text-ink-muted mt-0.5">
                          {k.replace(/_/g, " ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-rule rounded-sm p-3">
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted">Authority citations</p>
                  <p className="text-2xl font-serif mt-0.5">
                    ≥ {proposal.entity_data_requirements.required_authority_citations ?? 0}
                  </p>
                </div>
                <div className="border border-rule rounded-sm p-3">
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted">Originality threshold</p>
                  <p className="text-2xl font-serif mt-0.5">
                    ≥ {proposal.entity_data_requirements.originality_threshold ?? 0}
                  </p>
                  <p className="text-[10px] text-ink-muted mt-1">proprietary points outside top-10 SERP</p>
                </div>
              </div>
              {!!proposal.entity_data_requirements.recommended_schema_types?.length && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">
                    Recommended JSON-LD schema
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {proposal.entity_data_requirements.recommended_schema_types.map((t) => (
                      <span
                        key={t}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-sm bg-accent/10 text-accent border border-accent/30"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}
      </div>

      <div className="mt-10 pt-6 border-t border-rule flex items-center justify-between gap-4">
        <button onClick={abort} className="text-xs text-destructive hover:underline">Discard project</button>
        <button
          onClick={confirm}
          disabled={confirming}
          className="bg-ink text-paper px-5 py-2.5 rounded-sm text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50 inline-flex items-center gap-2"
        >
          {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm brief & start deep research
        </button>
      </div>
    </div>
    </>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="notebook-card p-5">
      <h3 className="font-serif text-lg mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-ink-muted italic mb-4">{subtitle}</p>}
      {children}
    </section>
  );
}

function Reasoning({ text, label }: { text: string; label: string }) {
  return (
    <div className="mt-3 p-3 bg-secondary border-l-2 border-accent">
      <p className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">{label}</p>
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
}

function CompetitionPill({ level }: { level: string }) {
  const cls =
    level === "low"
      ? "bg-verified/15 text-verified"
      : level === "high"
      ? "bg-destructive/15 text-destructive"
      : "bg-unverified/15 text-unverified";
  return <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm ${cls}`}>{level}</span>;
}

function CandidateList({
  candidates,
  selectedUrl,
  onSelect,
}: {
  candidates: { url: string; publisher?: string; why: string; rank: number; serp_position?: number }[];
  selectedUrl: string;
  onSelect: (url: string) => void;
}) {
  const sorted = candidates.slice().sort((a, b) => a.rank - b.rank);
  return (
    <div className="space-y-2">
      {sorted.map((c) => {
        const selected = c.url === selectedUrl;
        return (
          <div
            key={c.url}
            onClick={() => onSelect(c.url)}
            className={`p-3 border rounded-sm cursor-pointer ${selected ? "border-accent bg-accent/5" : "border-rule hover:border-ink"}`}
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] text-ink-muted">#{c.rank}</span>
                {c.publisher && <span className="text-xs font-medium">{c.publisher}</span>}
                {c.serp_position && <span className="text-[10px] text-ink-muted">SERP #{c.serp_position}</span>}
              </div>
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-accent text-xs hover:underline inline-flex items-center gap-1 shrink-0"
              >
                open <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-sm text-ink leading-snug">{c.why}</p>
            <p className="text-[10px] text-ink-muted font-mono mt-1 truncate">{c.url}</p>
          </div>
        );
      })}
    </div>
  );
}

function UrlOverride({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mt-3 w-full px-3 py-2 bg-background border border-rule rounded-sm text-sm font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}
