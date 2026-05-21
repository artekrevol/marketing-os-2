import { Router } from "express";
import { requireAuth, requireAdmin } from "../../middlewares/auth.js";
import { getQueue } from "@workspace/jobs";
import {
  buildRoutedSystem,
  buildRoutedSystemWithProject,
  logUsage,
  buildAnthropicUserId,
  STAGE_KEYS,
  parsePlaybookSections,
  ALWAYS_INCLUDE,
  type StageKey,
} from "@workspace/content-ai";
import {
  db,
  projectsTable,
  researchBriefsTable,
  proofPointsTable,
  outlinesTable,
  draftsTable,
  draftScoresTable,
  voiceLibraryTable,
  interviewAnswersTable,
  playbookTable,
  playbookSectionsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20251001";

function apiKey(): string {
  const k = process.env["ANTHROPIC_API_KEY"];
  if (!k) throw new Error("ANTHROPIC_API_KEY not set");
  return k;
}

async function callAnthropicRaw(body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  return resp.json() as Promise<any>;
}

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/propose-brief
 * Enqueues the brief proposal job and returns 202 immediately.
 * ───────────────────────────────────────────────────────────── */
router.post("/propose-brief", requireAuth, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }

    const rows = await db.select({ id: projectsTable.id, topic: projectsTable.topic }).from(projectsTable).where(eq(projectsTable.id, project_id)).limit(1);
    const project = rows[0];
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const topicTrimmed = String(project.topic || "").trim();
    if (topicTrimmed.length === 0) { res.status(400).json({ error: "Project topic is empty." }); return; }
    if (topicTrimmed.length > 200) {
      res.status(400).json({ error: `Project topic exceeds 200 characters (got ${topicTrimmed.length}).` });
      return;
    }

    await db.update(projectsTable).set({ status: "brief_proposing" }).where(eq(projectsTable.id, project_id));

    await getQueue("ai").add("ai.propose-brief", {
      idempotencyKey: `propose-brief:${project_id}`,
      project_id,
    });

    res.status(202).json({ ok: true, status: "queued" });
  } catch (e) {
    req.log.error({ err: e }, "propose-brief route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/research-generate
 * Enqueues the full 7-stage research run. Returns 200 immediately.
 * ───────────────────────────────────────────────────────────── */
router.post("/research-generate", requireAuth, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }

    await getQueue("ai").add("ai.research-generate", {
      idempotencyKey: `research-generate:${project_id}:${Date.now()}`,
      project_id,
    });

    res.json({ ok: true, started: STAGE_KEYS });
  } catch (e) {
    req.log.error({ err: e }, "research-generate route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/research-retry-card
 * Enqueues a single-stage retry. Returns 200 immediately.
 * ───────────────────────────────────────────────────────────── */
router.post("/research-retry-card", requireAuth, async (req, res) => {
  try {
    const { project_id, stage } = req.body as { project_id?: string; stage?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }
    if (!stage || !(STAGE_KEYS as readonly string[]).includes(stage)) {
      res.status(400).json({ error: `invalid stage: ${stage}` });
      return;
    }

    await getQueue("ai").add("ai.research-retry-card", {
      idempotencyKey: `research-retry-card:${project_id}:${stage}:${Date.now()}`,
      project_id,
      stage: stage as StageKey,
    });

    res.json({ ok: true, stage });
  } catch (e) {
    req.log.error({ err: e }, "research-retry-card route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/outline-generate
 * ───────────────────────────────────────────────────────────── */
const OUTLINE_TOOL = {
  name: "submit_outline",
  input_schema: {
    type: "object",
    properties: {
      h1: { type: "string" },
      meta_description: { type: "string" },
      tone_reminder: { type: "string" },
      cta_placement: { type: "string" },
      internal_links: { type: "array", items: { type: "string" } },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            heading: { type: "string" },
            level: { type: "string", enum: ["H2", "H3"] },
            job: { type: "string" },
            word_count: { type: "number" },
            proof_points: { type: "array", items: { type: "string" } },
            internal_links: { type: "array", items: { type: "string" } },
            why_it_converts: { type: "string" },
            atomic_questions: { type: "array", items: { type: "string" } },
            required_entities: { type: "array", items: { type: "string" } },
            required_citations: { type: "array", items: { type: "string" } },
            ai_citation_likelihood: { type: "string", enum: ["high", "medium", "low"] },
            schema_markup_types: { type: "array", items: { type: "string" } },
          },
          required: ["id", "heading", "level", "job", "word_count"],
        },
      },
    },
    required: ["h1", "meta_description", "sections"],
  },
};

router.post("/outline-generate", requireAuth, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }

    const [projectRows, briefRows, proofRows] = await Promise.all([
      db.select().from(projectsTable).where(eq(projectsTable.id, project_id)).limit(1),
      db.select().from(researchBriefsTable).where(eq(researchBriefsTable.projectId, project_id)).limit(1),
      db.select().from(proofPointsTable).where(and(eq(proofPointsTable.projectId, project_id), eq(proofPointsTable.starred, true))),
    ]);
    const project = projectRows[0];
    const brief = briefRows[0];
    const proofs = proofRows;
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const outlineInstructions = `Honor the playbook for ICP language, banned phrases, and pillar alignment when shaping the outline.

You must also distribute the brief's atomic_question_map across sections — every atomic question with liftable_paragraph=true must be assigned to exactly one section as a standalone, citation-ready paragraph. Distribute the entity_data_requirements proportionally across sections so the article hits its minimums. Estimate ai_citation_likelihood for each section based on entity density, atomic-question coverage, and citation plan.`;

    const { system: routedSystem, included } = await buildRoutedSystem("outline", outlineInstructions);
    req.log.info({ sections: included }, "outline-generate: routed playbook sections");

    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage2",
      substage: "outline",
      writer_id: project.writerId,
    });

    const t0 = Date.now();
    const data = await callAnthropicRaw({
      model: SONNET,
      max_tokens: 4000,
      metadata: { user_id: metadataUserId },
      tools: [OUTLINE_TOOL],
      tool_choice: { type: "tool", name: "submit_outline" },
      system: routedSystem,
      messages: [
        {
          role: "user",
          content: `Build an outline for a ${project.contentType} on "${project.topic}" (${project.funnelStage}, keyword: ${project.keyword}).

Approved research:
${JSON.stringify(brief, null, 2).slice(0, 8000)}

Starred proof points:
${JSON.stringify(proofs, null, 2).slice(0, 4000)}

Produce 6-9 sections. Each section gets:
- unique id (e.g. "s1"), heading, level (H2/H3), one-sentence job, target word count
- proof_points: ids the section should deploy
- internal_links
- why_it_converts: one line
- atomic_questions: verbatim questions from the brief's atomic_question_map this section must answer (each as a liftable paragraph)
- required_entities: which named entities (specific clients, dollar amounts, dates, locations, processes, people) this section must include — pull from synergy_map and entity_data_requirements
- required_citations: which authority publishers / URLs this section must inline-cite — pull from suggested_authority_sources and proof_points
- ai_citation_likelihood: high/medium/low
- schema_markup_types: JSON-LD types this section supports (FAQPage for Q&A blocks, HowTo for stepwise content, etc.)

Cover EVERY atomic question with liftable_paragraph=true at least once. Distribute entities and citations so the article hits the entity_data_requirements minimums. Also produce H1, meta description (<160 chars), tone reminder, and CTA placement notes.`,
        },
      ],
    });

    await logUsage({
      project_id,
      stage: "outline",
      model: SONNET,
      metadata_user_id: metadataUserId,
      usage: data.usage,
      duration_ms: Date.now() - t0,
      ok: true,
    });

    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!toolUse) throw new Error("No outline returned");
    const out = toolUse.input;

    await db
      .insert(outlinesTable)
      .values({
        projectId: project_id,
        brandId: project.brandId,
        h1: out.h1,
        metaDescription: out.meta_description,
        sections: out.sections,
        ctaPlacement: out.cta_placement,
        internalLinks: out.internal_links || [],
        toneReminder: out.tone_reminder,
      })
      .onConflictDoUpdate({
        target: outlinesTable.projectId,
        set: {
          h1: out.h1,
          metaDescription: out.meta_description,
          sections: out.sections,
          ctaPlacement: out.cta_placement,
          internalLinks: out.internal_links || [],
          toneReminder: out.tone_reminder,
          updatedAt: new Date(),
        },
      });

    await db.update(projectsTable).set({ currentStage: 2, status: "outlining" }).where(eq(projectsTable.id, project_id));

    res.json({ ok: true, outline: out });
  } catch (e) {
    req.log.error({ err: e }, "outline-generate route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/draft-section
 * ───────────────────────────────────────────────────────────── */
const DRAFT_TOOL = {
  name: "submit_draft",
  input_schema: {
    type: "object",
    properties: {
      content: { type: "string" },
      citation_count: { type: "number" },
      atomic_chunks_count: { type: "number" },
      schema_markup_recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["FAQPage", "HowTo", "Article", "BlogPosting", "LocalBusiness", "Organization", "Product", "Review"] },
            jsonld: { type: "object" },
          },
          required: ["type", "jsonld"],
        },
      },
    },
    required: ["content"],
  },
};

const REVIEW_TOOL = {
  name: "submit_review",
  input_schema: {
    type: "object",
    properties: {
      review_questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["factual", "detail", "structural"] },
            question: { type: "string" },
          },
          required: ["kind", "question"],
        },
      },
      voice_flags: {
        type: "array",
        items: {
          type: "object",
          properties: { phrase: { type: "string" }, reason: { type: "string" }, alternative: { type: "string" } },
        },
      },
      voice_match_score: { type: "number" },
      entity_density_score: { type: "number" },
      ai_citation_readiness_score: { type: "number" },
      ai_citation_flags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["missing_entity", "missing_citation", "weak_atomic_chunk", "no_schema"] },
            detail: { type: "string" },
          },
          required: ["kind", "detail"],
        },
      },
    },
    required: ["review_questions"],
  },
};

function countInlineCitations(text: string): number {
  if (!text) return 0;
  const re = /\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) seen.add(m[2]!);
  return seen.size;
}

function normalizeUrl(u: string): { full: string; host: string } | null {
  try {
    const url = new URL(u.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.host.toLowerCase().replace(/^www\./, "");
    const full = `${url.protocol}//${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    return { full, host };
  } catch { return null; }
}

function buildCitationWhitelist(args: { proofs: any[]; brief: any; project: any }): { hosts: Set<string>; sources: Array<{ url: string; host: string; label: string }> } {
  const hosts = new Set<string>();
  const sources: Array<{ url: string; host: string; label: string }> = [];
  const add = (raw: string | null | undefined, label: string) => {
    if (!raw) return;
    const n = normalizeUrl(raw);
    if (!n) return;
    hosts.add(n.host);
    sources.push({ url: n.full, host: n.host, label });
  };
  for (const p of args.proofs) add(p?.sourceUrl, p?.sourcePublication || "proof point");
  const landscape = (args.brief?.aiCitationLandscape || args.brief?.ai_citation_landscape) as any;
  for (const s of landscape?.top_cited_sources || []) add(s?.url, s?.publisher || "authority");
  for (const s of landscape?.suggested_authority_sources || []) add(s?.url_or_topic, s?.publisher || "authority");
  if (args.project?.companyDomain) add(`https://${args.project.companyDomain}`, "self");
  return { hosts, sources };
}

function enforceCitationWhitelist(text: string, hosts: Set<string>): { text: string; stripped: number } {
  if (!text) return { text, stripped: 0 };
  let stripped = 0;
  const out = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, (_m, label, url) => {
    const n = normalizeUrl(url);
    if (n && hosts.has(n.host)) return `[${label}](${url})`;
    stripped++;
    return label;
  });
  return { text: out, stripped };
}

router.post("/draft-section", requireAuth, async (req, res) => {
  try {
    const { project_id, section_id, revision_instruction } = req.body as {
      project_id?: string; section_id?: string; revision_instruction?: string;
    };
    if (!project_id || !section_id) { res.status(400).json({ error: "project_id and section_id required" }); return; }

    const [projectRows, outlineRows, proofRows, briefRows, existingRows] = await Promise.all([
      db.select().from(projectsTable).where(eq(projectsTable.id, project_id)).limit(1),
      db.select().from(outlinesTable).where(eq(outlinesTable.projectId, project_id)).limit(1),
      db.select().from(proofPointsTable).where(and(eq(proofPointsTable.projectId, project_id), eq(proofPointsTable.starred, true))),
      db.select({ synergyMap: researchBriefsTable.synergyMap, conversionSignals: researchBriefsTable.conversionSignals, aiCitationLandscape: researchBriefsTable.aiCitationLandscape, atomicQuestionMap: researchBriefsTable.atomicQuestionMap, entityDataRequirements: researchBriefsTable.entityDataRequirements, updatedAt: researchBriefsTable.updatedAt }).from(researchBriefsTable).where(eq(researchBriefsTable.projectId, project_id)).limit(1),
      db.select().from(draftsTable).where(and(eq(draftsTable.projectId, project_id), eq(draftsTable.sectionId, section_id))).limit(1),
    ]);
    const project = projectRows[0];
    const outline = outlineRows[0];
    const proofs = proofRows;
    const brief = briefRows[0];
    const existing = existingRows[0];
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const section = (outline?.sections as any[])?.find((s: any) => s.id === section_id);
    if (!section) { res.status(400).json({ error: "section not in outline" }); return; }

    const totalSections = (outline?.sections as any[])?.length ?? 0;
    const sectionIndex = ((outline?.sections as any[])?.findIndex((s: any) => s.id === section_id) ?? -1) + 1;
    const atomicForSection: string[] = (section as any).atomic_questions || [];
    const requiredEntities: string[] = (section as any).required_entities || [];
    const requiredCitations: string[] = (section as any).required_citations || [];
    const sectionSchemas: string[] = (section as any).schema_markup_types || [];
    const suggestedAuthorities = ((brief?.aiCitationLandscape) as any)?.suggested_authority_sources || [];
    const whitelist = buildCitationWhitelist({ proofs, brief, project });
    const whitelistBlock = whitelist.sources.length
      ? whitelist.sources.slice(0, 25).map((s) => `- ${s.label}: ${s.url}`).join("\n")
      : "(no verified sources for this project — do not invent any citations)";

    const projectContext = `=== PROJECT CONTEXT (shared across all sections) ===
Content type: ${project.contentType}
Title (H1): ${outline?.h1}
Total sections: ${totalSections}
Company domain: ${project.companyDomain}

Synergy angle (${project.companyDomain}'s ownable POV):
${((brief?.synergyMap) as any)?.ownable_angle || "n/a"}

Tone reminder: ${outline?.toneReminder}
CTA guidance: ${outline?.ctaPlacement}
Conversion belief required: ${((brief?.conversionSignals) as any)?.required_belief || ""}

Starred proof points (weave EVERY relevant one in with inline citation):
${JSON.stringify(proofs, null, 2)}

Suggested authority publishers (use when relevant):
${suggestedAuthorities.slice(0, 8).map((s: any) => `- ${s.publisher} (${s.url_or_topic || ""})`).join("\n")}

VERIFIED CITATION WHITELIST (the ONLY URLs you may cite inline):
${whitelistBlock}

CITATION RULES — non-negotiable:
- Inline citations MUST use the form [Publisher Name](https://real-url) where the URL is on the whitelist above (matching by host is OK, so deep links into a whitelisted domain are allowed).
- NEVER invent, guess, or hallucinate URLs. If a claim has no whitelisted source, write the claim WITHOUT a citation rather than inventing one.
- Do not cite Wikipedia or AI-generated content even if it appears in the whitelist.

Banned phrases (do not use): "in today's fast-paced world", "in conclusion", "leverage", "synergy", "delve", "navigate the landscape", "game-changer", "unlock the power".
=== END PROJECT CONTEXT ===`;

    const projectCacheTag = `project:${project_id}|outline:${outline?.updatedAt || ""}|brief:${brief?.updatedAt || ""}|proofs:${proofs.length}`;

    const stageInstructions = revision_instruction
      ? `You are revising Section ${sectionIndex} of ${totalSections} ("${section.heading}").

Writer's revision instruction (FOLLOW THIS LITERALLY — this is the user's primary intent):
"""
${revision_instruction}
"""

Current draft:
"""
${existing?.content || ""}
"""

REVISION RULES:
1. The writer's instruction above is the PRIMARY directive. Apply it fully and visibly — do not return content that looks identical to the current draft.
2. If the instruction asks for bullet points, convert relevant prose into actual markdown bullets ("- item").
3. If the instruction asks for a reference link or citation, add a real inline citation in the form [Publisher](https://real-url) using one of the suggested authority publishers above or a starred proof point. Never invent URLs.
4. If the instruction asks for examples, statistics, or specifics, pull them from the starred proof points or suggested authorities in the project context.
5. Preserve the section's heading, target word count (±20%), and any inline citations that are still relevant.
6. Return the FULL revised section content via submit_draft (not a diff).`
      : `You are drafting Section ${sectionIndex} of ${totalSections} ("${section.heading}"). ${section.word_count}-word target. Job: ${section.job}.

=== AI CITATION REQUIREMENTS FOR THIS SECTION ===

Atomic questions this section MUST answer as standalone, liftable paragraphs (each paragraph reads correctly out of context, completely answers one question):
${atomicForSection.length ? atomicForSection.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none assigned — still aim for at least one liftable Q&A-style paragraph if topical)"}

Required named entities this section must include (clients, dollar amounts, dates, locations, named processes, named people):
${requiredEntities.length ? requiredEntities.map((e) => `- ${e}`).join("\n") : "(none specified — still aim for concrete proper nouns over generics)"}

Required authority citations this section must inline-cite as [Publisher](url):
${requiredCitations.length ? requiredCitations.map((c) => `- ${c}`).join("\n") : "(none specified)"}

Schema markup types this section supports: ${sectionSchemas.join(", ") || "(none assigned)"}

RULES:
1. Structure AT LEAST ONE paragraph as a standalone liftable answer to one of the atomic questions above. That paragraph must read correctly out of context.
2. Include EVERY required named entity by name (not generic placeholders).
3. Inline-cite every required authority source with a real URL.
4. If a schema_markup_type is FAQPage, format the relevant Q&A as a clear question heading + answer paragraph and emit the JSON-LD in schema_markup_recommendations. If HowTo, emit ordered steps + JSON-LD.

Produce real prose. Do not produce a brief. Then call submit_draft with:
- content: the full prose for this section, with inline [Publisher](url) citations
- citation_count: number of inline citations
- atomic_chunks_count: number of standalone liftable paragraphs
- schema_markup_recommendations: JSON-LD for any schema this section supports`;

    const userMessage = revision_instruction ? "Revise per the instruction above. Call submit_draft." : "Draft this section now. Call submit_draft.";
    const draftSubstage = revision_instruction ? `revise_section_${sectionIndex}` : `draft_section_${sectionIndex}`;
    const metadataUserId = buildAnthropicUserId({ pod: project.pod, stage: "stage3", substage: draftSubstage, writer_id: project.writerId });

    const { system, included } = await buildRoutedSystemWithProject("draft", projectContext, projectCacheTag, stageInstructions);
    req.log.info({ sections: included, cacheTag: projectCacheTag }, "draft-section: routed playbook sections");

    const t0 = Date.now();
    const draftData = await callAnthropicRaw({
      model: SONNET,
      max_tokens: 4000,
      metadata: { user_id: metadataUserId },
      system,
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: "submit_draft" },
      messages: [{ role: "user", content: userMessage }],
    });
    await logUsage({ project_id, stage: "draft", sub_stage: section_id, model: SONNET, metadata_user_id: metadataUserId, usage: draftData.usage, duration_ms: Date.now() - t0, ok: true });

    const draftToolUse = (draftData.content || []).find((b: any) => b.type === "tool_use");
    if (!draftToolUse) throw new Error("No draft returned");
    const out = draftToolUse.input;

    const enforced = enforceCitationWhitelist(out.content || "", whitelist.hosts);
    if (enforced.stripped > 0) req.log.info({ stripped: enforced.stripped, section_id }, "draft-section: stripped non-whitelisted citations");
    out.content = enforced.text;
    const realCitationCount = countInlineCitations(out.content || "");

    const reviewMetaUserId = buildAnthropicUserId({ pod: project.pod, stage: "stage3", substage: `review_section_${sectionIndex}`, writer_id: project.writerId });
    const reviewSystem = `You are a strict editorial critic. Read the draft section and score it. Return:\n- review_questions: exactly 3 (one factual, one detail, one structural)\n- voice_flags: phrases that sound generic or off-brand, with alternatives\n- voice_match_score: 0-100\n- entity_density_score: 0-100 (% of required_entities actually present)\n- ai_citation_readiness_score: 0-100 composite\n- ai_citation_flags: gaps in entities, citations, atomic chunks, or schema`;
    const reviewUser = `Section: "${section.heading}"\n\nRequired entities (check inclusion):\n${requiredEntities.length ? requiredEntities.map((e) => `- ${e}`).join("\n") : "(none)"}\n\nRequired citations:\n${requiredCitations.length ? requiredCitations.map((c) => `- ${c}`).join("\n") : "(none)"}\n\nAtomic questions the section is supposed to answer:\n${atomicForSection.length ? atomicForSection.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none)"}\n\n=== DRAFT ===\n${out.content}\n=== END DRAFT ===\n\nCall submit_review.`;

    const t1 = Date.now();
    let review: any = null;
    try {
      const reviewData = await callAnthropicRaw({ model: HAIKU, max_tokens: 1500, metadata: { user_id: reviewMetaUserId }, system: reviewSystem, tools: [REVIEW_TOOL], tool_choice: { type: "tool", name: "submit_review" }, messages: [{ role: "user", content: reviewUser }] });
      await logUsage({ project_id, stage: "draft", sub_stage: `${section_id}:review`, model: HAIKU, metadata_user_id: reviewMetaUserId, usage: reviewData.usage, duration_ms: Date.now() - t1, ok: true });
      const reviewToolUse = (reviewData.content || []).find((b: any) => b.type === "tool_use");
      review = reviewToolUse?.input ?? null;
    } catch (e) {
      req.log.warn({ err: e }, "draft-section: review pass failed (non-fatal)");
    }

    await db
      .insert(draftsTable)
      .values({
        projectId: project_id,
        brandId: project.brandId,
        sectionId: section_id,
        sectionHeading: section.heading,
        content: out.content,
        reviewQuestions: review?.review_questions || [],
        voiceFlags: review?.voice_flags || [],
        voiceMatchScore: String(review?.voice_match_score ?? 75),
        citationCount: realCitationCount,
        atomicChunksCount: out.atomic_chunks_count ?? 0,
        entityDensityScore: review?.entity_density_score != null ? String(review.entity_density_score) : null,
        aiCitationReadinessScore: review?.ai_citation_readiness_score != null ? String(review.ai_citation_readiness_score) : null,
        schemaMarkupRecommendations: out.schema_markup_recommendations || [],
        revisionCount: existing ? (existing.revisionCount || 0) + 1 : 0,
        approved: existing?.approved ?? false,
      })
      .onConflictDoUpdate({
        target: [draftsTable.projectId, draftsTable.sectionId],
        set: {
          sectionHeading: section.heading,
          content: out.content,
          reviewQuestions: review?.review_questions || [],
          voiceFlags: review?.voice_flags || [],
          voiceMatchScore: String(review?.voice_match_score ?? 75),
          citationCount: realCitationCount,
          atomicChunksCount: out.atomic_chunks_count ?? 0,
          entityDensityScore: review?.entity_density_score != null ? String(review.entity_density_score) : null,
          aiCitationReadinessScore: review?.ai_citation_readiness_score != null ? String(review.ai_citation_readiness_score) : null,
          schemaMarkupRecommendations: out.schema_markup_recommendations || [],
          revisionCount: existing ? (existing.revisionCount || 0) + 1 : 0,
          updatedAt: new Date(),
        },
      });

    if (revision_instruction && existing?.content) {
      await db.insert(voiceLibraryTable).values({
        projectId: project_id,
        brandId: project.brandId,
        writerId: project.writerId,
        originalAiText: existing.content,
        editedHumanText: out.content,
        editType: "revision",
      });
    }

    await db.update(projectsTable).set({ currentStage: 3, status: "drafting" }).where(eq(projectsTable.id, project_id));

    res.json({ ok: true, draft: { ...out, ...(review || {}) } });
  } catch (e) {
    req.log.error({ err: e }, "draft-section route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/interview-step
 * ───────────────────────────────────────────────────────────── */
router.post("/interview-step", requireAuth, async (req, res) => {
  try {
    const { project_id, section_id, last_answer } = req.body as {
      project_id?: string; section_id?: string; last_answer?: string;
    };
    if (!project_id || !section_id) { res.status(400).json({ error: "project_id and section_id required" }); return; }

    const [projectRows, outlineRows, priorRows] = await Promise.all([
      db.select().from(projectsTable).where(eq(projectsTable.id, project_id)).limit(1),
      db.select({ sections: outlinesTable.sections, h1: outlinesTable.h1 }).from(outlinesTable).where(eq(outlinesTable.projectId, project_id)).limit(1),
      db.select().from(interviewAnswersTable).where(eq(interviewAnswersTable.projectId, project_id)).orderBy(interviewAnswersTable.createdAt),
    ]);
    const project = projectRows[0];
    const outline = outlineRows[0];
    const prior = priorRows;
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const section = (outline?.sections as any[])?.find((s: any) => s.id === section_id);

    const interviewInstructions = `You are interviewing the writer to extract their voice and POV for the section "${section?.heading}" (job: ${section?.job}) of "${outline?.h1}". Ask ONE question at a time. Reactive, conversational. Build on prior answers. Use playbook ICP/voice context to ask sharper questions.`;
    const { system: routedSystem, included } = await buildRoutedSystem("interview", interviewInstructions);
    req.log.info({ sections: included }, "interview-step: routed playbook sections");

    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage3",
      substage: `interview_${section_id}`,
      writer_id: project.writerId,
    });

    const t0 = Date.now();
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 800,
        metadata: { user_id: metadataUserId },
        system: routedSystem,
        messages: [
          {
            role: "user",
            content: `Prior Q&A:\n${prior.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join("\n\n")}\n\nLast answer from writer: ${last_answer || "(none yet — ask the first question)"}\n\nReact briefly (1 sentence) to the last answer, then ask the next question. Return only:\nREACTION: ...\nNEXT_QUESTION: ...`,
          },
        ],
      }),
    });
    const data = await resp.json() as any;
    await logUsage({
      project_id,
      stage: "interview",
      sub_stage: section_id,
      model: SONNET,
      metadata_user_id: metadataUserId,
      usage: data.usage,
      duration_ms: Date.now() - t0,
      ok: resp.ok,
    });

    const text = (data.content || []).find((b: any) => b.type === "text")?.text || "";
    const reaction = text.match(/REACTION:\s*(.+?)(?=NEXT_QUESTION:|$)/s)?.[1]?.trim() || "";
    const next_question = text.match(/NEXT_QUESTION:\s*(.+)/s)?.[1]?.trim() || "Tell me more.";

    res.json({ reaction, next_question });
  } catch (e) {
    req.log.error({ err: e }, "interview-step route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/final-stitch
 * ───────────────────────────────────────────────────────────── */
const BANNED_PHRASES = [
  "in today's fast-paced world", "in conclusion", "leverage", "synergy",
  "delve", "navigate the landscape", "game-changer", "unlock the power",
];

router.post("/final-stitch", requireAuth, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }

    const [projectRows, outlineRows, draftRows, briefRows] = await Promise.all([
      db.select({ id: projectsTable.id, brandId: projectsTable.brandId }).from(projectsTable).where(eq(projectsTable.id, project_id)).limit(1),
      db.select().from(outlinesTable).where(eq(outlinesTable.projectId, project_id)).limit(1),
      db.select().from(draftsTable).where(eq(draftsTable.projectId, project_id)),
      db.select({ atomicQuestionMap: researchBriefsTable.atomicQuestionMap, entityDataRequirements: researchBriefsTable.entityDataRequirements, aiCitationLandscape: researchBriefsTable.aiCitationLandscape }).from(researchBriefsTable).where(eq(researchBriefsTable.projectId, project_id)).limit(1),
    ]);
    const project = projectRows[0];
    const outline = outlineRows[0];
    const drafts = draftRows;
    const brief = briefRows[0];
    if (!project) { res.status(404).json({ error: "project not found" }); return; }
    if (!outline) { res.status(500).json({ error: "outline not found" }); return; }

    const sectionsOrder = (outline.sections as any[]).map((s: any) => s.id);
    const ordered = sectionsOrder
      .map((id: string) => drafts.find((d) => d.sectionId === id))
      .filter(Boolean) as typeof drafts;

    let stitched = `# ${(outline as any).h1}\n\n`;
    for (const d of ordered) stitched += `## ${d.sectionHeading}\n\n${d.content}\n\n`;

    const word_count = stitched.split(/\s+/).filter(Boolean).length;
    const lower = stitched.toLowerCase();
    const banned_phrase_count = BANNED_PHRASES.reduce((n, p) => n + (lower.split(p).length - 1), 0);
    const withCites = ordered.filter((d) => (d.citationCount || 0) > 0).length;
    const citation_completeness = ordered.length ? Math.round((withCites / ordered.length) * 100) : 0;
    const voice_match_score = ordered.length
      ? Math.round(ordered.reduce((s, d) => s + (Number(d.voiceMatchScore) || 0), 0) / ordered.length)
      : 0;
    const ai_citation_readiness_score = ordered.length
      ? Math.round(ordered.reduce((s, d) => s + (Number(d.aiCitationReadinessScore) || 0), 0) / ordered.length)
      : 0;
    const atomic_chunks_count = ordered.reduce((n, d) => n + (Number(d.atomicChunksCount) || 0), 0);
    const atomic_questions_count = Array.isArray(brief?.atomicQuestionMap)
      ? (brief!.atomicQuestionMap as any[]).filter((q: any) => q.liftable_paragraph).length
      : 0;

    const schemaSet = new Map<string, any>();
    for (const d of ordered) {
      for (const r of ((d.schemaMarkupRecommendations as any[]) || [])) {
        if (r?.type && r?.jsonld && !schemaSet.has(r.type)) schemaSet.set(r.type, r.jsonld);
      }
    }
    if (!schemaSet.has("Article") && !schemaSet.has("BlogPosting")) {
      schemaSet.set("BlogPosting", { "@context": "https://schema.org", "@type": "BlogPosting", headline: (outline as any).h1 || "", description: (outline as any).metaDescription || "", wordCount: word_count });
    }
    const schema_markup_recommendations = Array.from(schemaSet.entries()).map(([type, jsonld]) => ({ type, jsonld }));

    let originality_score: number | null = null;
    const winstonKey = process.env["WINSTON_API_KEY"];
    if (winstonKey) {
      try {
        const o = await fetch("https://api.gowinston.ai/v2/ai-content-detection", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${winstonKey}` },
          body: JSON.stringify({ text: stitched.slice(0, 30000), sentences: false, language: "en" }),
        });
        if (o.ok) {
          const j = await o.json() as any;
          originality_score = typeof j?.score === "number" ? Math.round(j.score) : (j?.score?.human ?? j?.human_score ?? null);
        } else {
          req.log.warn({ status: o.status }, "final-stitch: gowinston non-ok");
        }
      } catch (e) {
        req.log.warn({ err: e }, "final-stitch: gowinston call failed (non-fatal)");
      }
    }

    await db
      .insert(draftScoresTable)
      .values({
        projectId: project_id,
        brandId: project.brandId,
        finalDraft: stitched,
        voiceMatchScore: String(voice_match_score),
        originalityScore: originality_score != null ? String(originality_score) : null,
        bannedPhraseCount: banned_phrase_count,
        wordCount: word_count,
        citationCompleteness: String(citation_completeness),
        aiCitationReadinessScore: String(ai_citation_readiness_score),
        atomicChunksCount: atomic_chunks_count,
        atomicQuestionsCount: atomic_questions_count,
        schemaMarkupRecommendations: schema_markup_recommendations,
      })
      .onConflictDoUpdate({
        target: draftScoresTable.projectId,
        set: {
          finalDraft: stitched,
          voiceMatchScore: String(voice_match_score),
          originalityScore: originality_score != null ? String(originality_score) : null,
          bannedPhraseCount: banned_phrase_count,
          wordCount: word_count,
          citationCompleteness: String(citation_completeness),
          aiCitationReadinessScore: String(ai_citation_readiness_score),
          atomicChunksCount: atomic_chunks_count,
          atomicQuestionsCount: atomic_questions_count,
          schemaMarkupRecommendations: schema_markup_recommendations,
          updatedAt: new Date(),
        },
      });

    await db.update(projectsTable).set({ currentStage: 4, status: "review" }).where(eq(projectsTable.id, project_id));

    res.json({ ok: true, word_count, voice_match_score, originality_score, banned_phrase_count, citation_completeness, ai_citation_readiness_score, atomic_chunks_count, atomic_questions_count, schema_markup_recommendations });
  } catch (e) {
    req.log.error({ err: e }, "final-stitch route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/playbook-upload   (admin-only)
 * ───────────────────────────────────────────────────────────── */
router.post("/playbook-upload", requireAdmin, async (req, res) => {
  try {
    const { filename, mime_type, content_base64, uploaded_by } = req.body as {
      filename?: string; mime_type?: string; content_base64?: string; uploaded_by?: string;
    };
    if (!filename || !content_base64) { res.status(400).json({ error: "filename and content_base64 are required" }); return; }

    const bytes = Buffer.from(content_base64, "base64");
    const lower = filename.toLowerCase();

    let markdown = "";
    if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt") || (mime_type || "").startsWith("text/")) {
      markdown = bytes.toString("utf-8");
    } else if (lower.endsWith(".pdf") || mime_type === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(doc, { mergePages: true });
      markdown = Array.isArray(text) ? text.join("\n\n") : String(text);
    } else if (lower.endsWith(".docx") || mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const mod = (mammoth as any).default ?? mammoth;
      const result = await mod.convertToMarkdown({ buffer: bytes });
      markdown = result.value || "";
    } else {
      res.status(400).json({ error: `Unsupported file type: ${filename}` });
      return;
    }

    markdown = (markdown || "").trim();
    if (!markdown) { res.status(400).json({ error: "Extracted playbook is empty." }); return; }

    const latestRows = await db.select({ version: playbookTable.version }).from(playbookTable).orderBy(desc(playbookTable.version)).limit(1);
    const nextVersion = (latestRows[0]?.version ?? 0) + 1;

    const [playbookRow] = await db
      .insert(playbookTable)
      .values({ contentMarkdown: markdown, version: nextVersion, sourceFilename: filename, uploadedBy: uploaded_by || null })
      .returning();

    const sections = parsePlaybookSections(markdown);
    if (sections.length > 0) {
      const rows = sections.map((s) => ({
        version: nextVersion,
        sectionNumber: s.section_number,
        sectionTitle: s.section_title,
        sectionContent: s.section_content,
        sectionTokenEstimate: s.section_token_estimate,
        alwaysInclude: ALWAYS_INCLUDE.includes(s.section_number) || s.always_include,
      }));
      try {
        await db.insert(playbookSectionsTable).values(rows);
      } catch (e) {
        req.log.warn({ err: e }, "playbook-upload: section insert error (non-fatal)");
      }
    } else {
      req.log.warn("playbook-upload: no sections detected — routing will fall back to full doc");
    }

    res.json({ ok: true, playbook: playbookRow, sections_count: sections.length });
  } catch (e) {
    req.log.error({ err: e }, "playbook-upload route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/playbook-reparse   (admin-only)
 * ───────────────────────────────────────────────────────────── */
router.post("/playbook-reparse", requireAdmin, async (req, res) => {
  try {
    const latestRows = await db
      .select({ version: playbookTable.version, contentMarkdown: playbookTable.contentMarkdown })
      .from(playbookTable)
      .orderBy(desc(playbookTable.version))
      .limit(1);
    const latest = latestRows[0];
    if (!latest) { res.status(404).json({ error: "no playbook uploaded yet" }); return; }

    const version = latest.version;
    const markdown = latest.contentMarkdown || "";
    const sections = parsePlaybookSections(markdown);

    if (sections.length === 0) {
      res.json({ ok: false, version, sections_count: 0, error: "no sections detected" });
      return;
    }

    await db.delete(playbookSectionsTable).where(eq(playbookSectionsTable.version, version));
    const rows = sections.map((s) => ({
      version,
      sectionNumber: s.section_number,
      sectionTitle: s.section_title,
      sectionContent: s.section_content,
      sectionTokenEstimate: s.section_token_estimate,
      alwaysInclude: ALWAYS_INCLUDE.includes(s.section_number) || s.always_include,
    }));
    await db.insert(playbookSectionsTable).values(rows);

    res.json({ ok: true, version, sections_count: sections.length, sections: sections.map((s) => ({ n: s.section_number, title: s.section_title, tokens: s.section_token_estimate })) });
  } catch (e) {
    req.log.error({ err: e }, "playbook-reparse route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
