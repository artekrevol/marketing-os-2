import { Router } from "express";
import { requireAuth, requireAdmin, requireProjectAccess } from "../../middlewares/auth.js";
import { getQueue } from "@workspace/jobs";
import {
  buildRoutedSystem,
  buildRoutedSystemWithProject,
  createPlaybookVersion,
  getActivePlaybook,
  getBannedPhrases,
  logUsage,
  buildAnthropicUserId,
  STAGE_KEYS,
  parsePlaybookSections,
  ALWAYS_INCLUDE,
  runAllValidators,
  getPlaybookProjectNames,
  getCredentialBlock,
  computeLsiCoverage,
  AUTHORITY_WHITELIST,
  AHREFS_TOOL_DEFINITIONS,
  AHREFS_TOOL_NAME_SET,
  AHREFS_SYSTEM_ADDENDUM,
  executeAhrefsTool,
  type StageKey,
  type ValidatorDeps,
  type ArticleSchema,
} from "@workspace/content-ai";
import {
  db,
  brandsTable,
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
  moduleDataProvenanceTable,
  isReviewInBank,
  getConfidentialCompanies,
  isUrlInLinkTargets,
  getAnchorVariations,
  getReviewsBankProjectNames,
  findTestimonials,
  findLinkTargets,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

const router = Router();

function resolvedRequestBrand(req: { brandContext?: { brandId: string } }): string {
  const brandId = req.brandContext?.brandId;
  if (!brandId) throw new Error("brand context missing");
  return brandId;
}

/** True for loopback / private / link-local / unique-local / CGNAT addresses. */
function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("fe80")) return true; // link-local
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]!);
  return false;
}

/** SSRF guard: only allow http(s) URLs that resolve to public addresses. */
async function isSafePublicUrl(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dnsLookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20251001";

function apiKey(): string {
  const k = process.env["ANTHROPIC_API_KEY"];
  if (!k) throw new Error("ANTHROPIC_API_KEY not set");
  return k;
}

interface AhrefsToolContext {
  brandId: string;
  projectId: string;
}

/** Single raw fetch to Anthropic — no tool loop. */
async function fetchAnthropic(body: Record<string, unknown>): Promise<any> {
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

/**
 * Call Anthropic with an optional Ahrefs tool loop.
 *
 * When `options.toolContext` is provided:
 * - Ahrefs tool definitions are merged into body.tools.
 * - AHREFS_SYSTEM_ADDENDUM is appended to a string system prompt.
 * - The response loop intercepts ONLY Ahrefs tool_use blocks.
 * - Non-Ahrefs tool_use blocks (submit_draft, submit_article_schema, etc.)
 *   are treated as terminal and returned immediately — forced-tool calls
 *   (draft-section, review) are unaffected.
 * - Budget: 5 Ahrefs calls max per generation cycle.
 *
 * NOTE: calls that use `tool_choice: { type:"tool", name:"submit_*" }` are
 * functionally unaffected — the forced tool prevents the model from calling
 * Ahrefs tools, so the loop returns after the first fetch. The toolContext
 * path is most impactful for free-tool calls (e.g. repetition-rewrite).
 */
async function callAnthropicRaw(
  body: Record<string, unknown>,
  options?: { toolContext?: AhrefsToolContext; ahrefsBudget?: number },
): Promise<any> {
  const toolContext = options?.toolContext;

  // ── Fast path — no Ahrefs tool loop ───────────────────────────────────
  if (!toolContext) {
    return fetchAnthropic(body);
  }

  // ── Tool-loop path ─────────────────────────────────────────────────────
  const callBudget = { remaining: options?.ahrefsBudget ?? 5, used: 0 };

  // Merge Ahrefs tool definitions (prepend so model sees them before any forced tool)
  const existingTools = Array.isArray(body["tools"]) ? (body["tools"] as unknown[]) : [];
  const mergedTools = [...(AHREFS_TOOL_DEFINITIONS as unknown as unknown[]), ...existingTools];

  // Append Ahrefs system addendum (string system prompts only; cache-block arrays are left intact)
  let augmentedSystem = body["system"];
  if (typeof augmentedSystem === "string") {
    augmentedSystem = augmentedSystem + AHREFS_SYSTEM_ADDENDUM;
  }

  const augmentedBody: Record<string, unknown> = {
    ...body,
    tools: mergedTools,
    system: augmentedSystem,
  };

  let messages: unknown[] = Array.isArray(body["messages"]) ? [...(body["messages"] as unknown[])] : [];

  for (let iteration = 0; iteration < 10; iteration++) {
    const data = await fetchAnthropic({ ...augmentedBody, messages });

    // Identify Ahrefs tool_use blocks only — all others are terminal
    const ahrefsBlocks = ((data.content as any[]) ?? []).filter(
      (c: any) => c.type === "tool_use" && AHREFS_TOOL_NAME_SET.has(c.name as string),
    );

    if (ahrefsBlocks.length === 0) {
      // No Ahrefs tools used this turn — return as-is (may be submit_draft / text / etc.)
      return data;
    }

    // Cap to remaining budget
    const toExecute = ahrefsBlocks.slice(0, callBudget.remaining);

    // Execute in parallel
    const results = await Promise.all(
      toExecute.map((toolUse: any) =>
        executeAhrefsTool(
          toolContext.brandId,
          toolContext.projectId,
          toolUse as { name: string; input: Record<string, unknown>; id: string },
          { remaining: callBudget.remaining, used: callBudget.used },
        ),
      ),
    );

    const totalUsed = results.reduce((sum: number, r) => sum + r.budgetUsed, 0);
    callBudget.remaining -= totalUsed;
    callBudget.used += totalUsed;

    // Append assistant turn + tool results for next iteration
    messages = [
      ...messages,
      { role: "assistant", content: data.content },
      { role: "user", content: results.map((r: { toolResultBlock: unknown; budgetUsed: number }) => r.toolResultBlock) },
    ];

    // Budget exhausted — one final call to let model finish
    if (callBudget.remaining <= 0) {
      return fetchAnthropic({ ...augmentedBody, messages });
    }
  }

  throw new Error("Ahrefs tool loop exceeded 10 iterations without completing");
}

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/propose-brief
 * Enqueues the brief proposal job and returns 202 immediately.
 * ───────────────────────────────────────────────────────────── */
router.post("/propose-brief", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }
    const brandId = resolvedRequestBrand(req);

    const rows = await db.select({ id: projectsTable.id, topic: projectsTable.topic, brandId: projectsTable.brandId }).from(projectsTable).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1);
    const project = projectRows[0];
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const topicTrimmed = String(project.topic || "").trim();
    if (topicTrimmed.length === 0) { res.status(400).json({ error: "Project topic is empty." }); return; }
    if (topicTrimmed.length > 200) {
      res.status(400).json({ error: `Project topic exceeds 200 characters (got ${topicTrimmed.length}).` });
      return;
    }

    const playbook = await getActivePlaybook(project.brandId, project.playbookVersion);
    await db.update(projectsTable).set({ status: "brief_proposing" }).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId)));

    await getQueue("ai").add("ai.propose-brief", {
      idempotencyKey: `propose-brief:${project_id}`,
      project_id,
      brandId: project.brandId,
      playbookVersion: playbook.version,
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
router.post("/research-generate", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }
    const brandId = resolvedRequestBrand(req);

    const projectRows = await db.select({ brandId: projectsTable.brandId, playbookVersion: projectsTable.playbookVersion }).from(projectsTable).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1);
    const project = projectRows[0];
    if (!project) { res.status(404).json({ error: "project not found" }); return; }
    const playbook = await getActivePlaybook(project.brandId, project.playbookVersion);
    await getQueue("ai").add("ai.research-generate", {
      idempotencyKey: `research-generate:${project_id}-${Date.now()}`,
      project_id,
      brandId: project.brandId,
      playbookVersion: playbook.version,
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
router.post("/research-retry-card", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id, stage } = req.body as { project_id?: string; stage?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }
    if (!stage || !(STAGE_KEYS as readonly string[]).includes(stage)) {
      res.status(400).json({ error: `invalid stage: ${stage}` });
      return;
    }
    const brandId = resolvedRequestBrand(req);

    const projectRows = await db.select({ brandId: projectsTable.brandId, playbookVersion: projectsTable.playbookVersion }).from(projectsTable).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1);
    const project = projectRows[0];
    if (!project) { res.status(404).json({ error: "project not found" }); return; }
    const playbook = await getActivePlaybook(project.brandId, project.playbookVersion);
    await getQueue("ai").add("ai.research-retry-card", {
      idempotencyKey: `research-retry-card:${project_id}-${stage}-${Date.now()}`,
      project_id,
      stage: stage as StageKey,
      brandId: project.brandId,
      playbookVersion: playbook.version,
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
/**
 * Cut B Fix 5 — infer the checklist content type from the primary keyword
 * (falling back to the project's contentType). Mirrors the validator's
 * checklistKind() inference order (cost → comparison → how-to), plus the
 * stats type from the dispatch.
 */
function inferChecklistContentType(contentType: string | null | undefined, keyword: string | null | undefined): string {
  const t = `${contentType || ""} ${keyword}`.toLowerCase();
  if (/cost|price|pricing|how much/.test(t)) return "cost guide";
  if (/compar|vs\b|versus|alternative/.test(t)) return "comparison guide";
  if (/how to|how-to|guide|tutorial|step/.test(t)) return "how-to guide";
  if (/statistic|trends|\bdata\b/.test(t)) return "stats article";
  return contentType || "article";
}

/** Cut B Fix 5 — content-type-aware topic checklist injected at outline stage. */
function buildTopicChecklistBlock(contentType: string | null | undefined, keyword: string | null | undefined): string {
  const inferred = inferChecklistContentType(contentType, keyword);
  return `TOPIC COVERAGE CHECKLIST — this is a ${inferred} article. The outline MUST include sections covering every required sub-topic for its type:
- Cost guide: cost ranges, cost drivers, regional variation, team model, maintenance %, timeline, EXCLUSIONS (what the price does NOT include)
- Comparison guide: feature comparison, cost comparison, use-case fit, migration cost, recommendation
- How-to guide: prerequisites, numbered steps, common pitfalls, tools, expected outcome
- Stats article: hero stat, methodology, breakdown by segment, YoY comparison, source citations

Any missing required sub-topic will fail matrix check #20 and block ship. Verify your outline covers every item before returning.

LITERAL TERM RULE (cost guide only): the published article is scanned for the literal terms "cost range", "regional", "team model", and "exclusions". Ensure at least one section HEADING contains the phrase "Cost Range" or "Cost Ranges" (e.g. "Mobile App Cost Ranges by Complexity"), at least one contains the word "Regional" (e.g. "Regional Cost Differences..."), at least one contains the phrase "Team Model" (e.g. "Team Models: In-House vs Outsourced vs Hybrid"), and at least one contains the word "Exclusions" (e.g. "Pricing Exclusions: What Your Quote Does NOT Include"). Do not rely on synonyms like "cost breakdown", "by location", "team location", or "hidden costs" alone.`;
}

/**
 * Cut B Fix 7 — detect phrases of `minWords`+ words that repeat verbatim
 * across H2 sections of the assembled article (normalization mirrors the
 * repetition validator: strip markdown links, lowercase, alphanumerics only).
 */
function findCrossSectionRepetitions(md: string, minWords = 8, maxPhrases = 20): string[] {
  /* Mirrors the validator's splitSectionsByH2: the intro (everything before
   * the first H2, including the H1 line) counts as its own section. */
  const parts = md.split(/^## /m);
  const bodies = parts.map((p, i) => (i === 0 ? p : p.split("\n").slice(1).join(" ")));
  const phraseToSections = new Map<string, Set<number>>();
  bodies.forEach((body, idx) => {
    const words = body
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (let i = 0; i + minWords <= words.length; i++) {
      const gram = words.slice(i, i + minWords).join(" ");
      const set = phraseToSections.get(gram) || new Set<number>();
      set.add(idx);
      phraseToSections.set(gram, set);
    }
  });
  const repeated = [...phraseToSections.entries()].filter(([, s]) => s.size >= 2).map(([g]) => g);
  // Collapse overlapping n-grams: drop a gram if it shares 7 words with the previously kept one.
  const collapsed: string[] = [];
  for (const g of repeated) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.split(" ").slice(1).join(" ") === g.split(" ").slice(0, minWords - 1).join(" ")) continue;
    collapsed.push(g);
  }
  return collapsed.slice(0, maxPhrases);
}

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

router.post("/outline-generate", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }
    const brandId = resolvedRequestBrand(req);

    const [projectRows, briefRows, proofRows] = await Promise.all([
      db.select().from(projectsTable).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1),
      db.select().from(researchBriefsTable).where(and(eq(researchBriefsTable.projectId, project_id), eq(researchBriefsTable.brandId, brandId))).limit(1),
      db.select().from(proofPointsTable).where(and(eq(proofPointsTable.projectId, project_id), eq(proofPointsTable.brandId, brandId), eq(proofPointsTable.starred, true))),
    ]);
    const project = projectRows[0];
    const brief = briefRows[0];
    const proofs = proofRows;
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const outlineIcp = Array.isArray(project.icps) && project.icps.length ? (project.icps[0] as number) : undefined;
    const { block: outlineAssetBlock } = await buildAssetCandidates({
      brandId: project.brandId,
      icp: outlineIcp,
      funnelStage: project.funnelStage || undefined,
    });

    const outlineInstructions = `Honor the playbook for ICP language, banned phrases, and pillar alignment when shaping the outline.

You must also distribute the brief's atomic_question_map across sections — every atomic question with liftable_paragraph=true must be assigned to exactly one section as a standalone, citation-ready paragraph. Distribute the entity_data_requirements proportionally across sections so the article hits its minimums. Estimate ai_citation_likelihood for each section based on entity density, atomic-question coverage, and citation plan.`;

    const { system: routedSystem, version: playbookVersion, included } = await buildRoutedSystem(
      "interview",
      project.brandId,
      interviewInstructions,
      project.playbookVersion,
    );
    req.log.info({ brandId: project.brandId, playbookVersion, sections: included }, "interview-step: routed playbook sections");

    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage3",
      substage: `interview_${section_id}`,
      writer_id: project.writerId,
    });

      const t0 = Date.now();
    const data = await resp.json() as any;

    await logUsage({
      project_id,
      brand_id: project.brandId,
      stage: "outline",
      model: SONNET,
      metadata_user_id: metadataUserId,
      usage: data.usage,
      duration_ms: Date.now() - t0,
      ok: true,
    });

    const toolUse = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!toolUse) throw new Error("No outline returned");
          const out = (md.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();

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

    await db.update(projectsTable).set({ currentStage: 2, status: "outlining" }).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId)));

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
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            phrase: { type: "string", minLength: 1, maxLength: 80 },
            reason: { type: "string", minLength: 1, maxLength: 280 },
            alternative: { type: "string", maxLength: 80 },
          },
          required: ["phrase", "reason"],
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

// Sprint 1 #6 (hotfix): defense-in-depth sanitization for `voice_flags`
// before persistence. The REVIEW_TOOL schema constrains shape upstream,
// but Anthropic occasionally returns extra keys or non-string values
// (and historical drafts predate the schema constraint). We drop any
// item missing a usable phrase+reason, coerce to strings, strip control
// characters, and clamp lengths so the renderer never sees escaped-JSON
// soup leaking into the right-rail voice-flags panel.
function sanitizeVoiceFlags(raw: unknown): Array<{ phrase: string; reason: string; alternative?: string }> {
  // Recovery for the LLM-double-encode case: occasionally Anthropic returns
  // the voice_flags value as a JSON-stringified string instead of a real
  // array. Try one JSON.parse pass before falling back. If parsing yields
  // a non-array (or throws), behave as before and return [].
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const clean = (s: unknown, max: number): string => {
    if (typeof s !== "string") return "";
    // (1) Decode common escaped literals — when the LLM double-encodes a
    //     JSON-stringified value into a string field we get the literal
    //     two-character sequence `\` + `n`, not U+000A. Convert those to
    //     their real characters so the next pass collapses them.
    // (2) Strip real control chars (U+0000–U+001F, U+007F).
    // (3) Collapse all whitespace runs to a single space, trim, clamp.
    return s
      .replace(/\\r\\n|\\n|\\r|\\t/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  };
  const out: Array<{ phrase: string; reason: string; alternative?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const phrase = clean((item as any).phrase, 80);
    const reason = clean((item as any).reason, 280);
    if (!phrase || !reason) continue;
    const alternative = clean((item as any).alternative, 80);
    out.push(alternative ? { phrase, reason, alternative } : { phrase, reason });
    if (out.length >= 20) break;
  }
  return out;
}

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

/**
 * Cut A — candidate injection. Fetch the brand's approved testimonial + internal-
 * link candidates (and the authority-citation whitelist) and format them into a
 * block the generation prompts inject as "you MUST select from these — do not
 * invent". The reviews_bank / link_targets validators remain the verification
 * floor; this only gives the model real assets to anchor to so the asset-derived
 * gates (#15 internal links, #16 authority, testimonials) can actually pass.
 *
 * Filtered candidates are preferred (ICP / funnel-matched) but we fall back to a
 * brand-wide fetch when the filtered set is empty, so the model is never left
 * with nothing to select. Candidates are sorted by id before formatting so the
 * injected block is byte-identical across the section calls of one project —
 * preserving the prompt-cache hits that buildRoutedSystemWithProject relies on.
 */
async function buildAssetCandidates(opts: {
  brandId: string;
  icp?: number;
  vertical?: string;
  costBucket?: string;
  cluster?: string;
  funnelStage?: string;
}): Promise<{ block: string; linkHosts: string[]; linkTargetList: Array<{ url: string; anchors: string[] }> }> {
  const { brandId, icp, vertical, costBucket, cluster, funnelStage } = opts;
  const fs = funnelStage
    ? (funnelStage.toUpperCase() as "TOFU" | "MOFU" | "BOFU")
    : undefined;

  let tRes = await findTestimonials({ brandId, icp, vertical, costBucket, limit: 50 });
  if (tRes.data.length === 0 && (icp != null || vertical || costBucket)) {
    tRes = await findTestimonials({ brandId, limit: 50 });
  }
  let lRes = await findLinkTargets({ brandId, cluster, vertical, funnelStage: fs, icp, limit: 50 });
  if (lRes.data.length === 0 && (cluster || vertical || fs || icp != null)) {
    lRes = await findLinkTargets({ brandId, limit: 50 });
  }

  const testimonials = [...tRes.data].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 12);
  const linkTargets = [...lRes.data].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20);

  const tLines = testimonials.length
    ? testimonials
        .map((t) => {
          const role = t.reviewerRole ? `, ${t.reviewerRole}` : "";
          const proj = t.projectName ? ` [project: ${t.projectName}]` : "";
          return `- "${(t.quoteExcerpt || "").trim()}" — ${t.reviewerName}${role} at ${t.company}${proj}`;
        })
        .join("\n")
    : "(no testimonials on file for this brand — do not include any testimonial)";

  const linkHosts: string[] = [];
  const lLines = linkTargets.length
    ? linkTargets
        .map((l) => {
          try {
            linkHosts.push(new URL(l.url).host.toLowerCase().replace(/^www\./, ""));
          } catch { /* skip malformed url */ }
          const anchors = Array.isArray(l.anchorVariations)
            ? (l.anchorVariations as unknown[]).filter((x): x is string => typeof x === "string")
            : [];
          const meta = [l.contentCluster ? `cluster: ${l.contentCluster}` : "", `funnel: ${l.funnelStage}`]
            .filter(Boolean)
            .join(" | ");
          const anchorTxt = anchors.length ? ` | anchors: ${anchors.join(", ")}` : "";
          return `- ${l.url}${meta ? ` | ${meta}` : ""}${anchorTxt}`;
        })
        .join("\n")
    : "(no internal link targets on file for this brand — do not include internal links)";

  const authorityDomains = [...AUTHORITY_WHITELIST, "*.gov", "*.edu"].join(", ");

  const block = `=== APPROVED ASSET CANDIDATES — you MUST select from these lists; do NOT invent ===

TESTIMONIALS (select at least 1 relevant one; use the EXACT reviewer name, company, and quote excerpt):
${tLines}

INTERNAL LINK TARGETS (select exactly 5 relevant URLs — or ALL listed if fewer than 5 exist; use ONLY these URLs with one of the listed anchor variations; NEVER use a URL from memory of the company's site):
${lLines}

AUTHORITY CITATION DOMAINS (≥2 external authority citations required; cite ONLY from these domains or any .gov / .edu host):
${authorityDomains}

NON-NEGOTIABLE:
- You MUST select testimonials from the TESTIMONIALS list above — never invent a reviewer, company, or quote.
- You MUST select internal links from the INTERNAL LINK TARGETS list above — never invent a URL; use a listed anchor variation.
- External authority citations MUST come from the AUTHORITY CITATION DOMAINS above.
=== END ASSET CANDIDATES ===`;

  const linkTargetList = linkTargets.map((l) => ({
    url: l.url,
    anchors: Array.isArray(l.anchorVariations)
      ? (l.anchorVariations as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
  }));
  return { block, linkHosts, linkTargetList };
}

interface AhrefsPrePassResult {
  citation_candidates: Array<{ domain: string; dr: number; ur: number; is_authoritative: boolean }>;
  keyword_context: Array<{ keyword: string; volume: number; difficulty: number }>;
}

/**
 * Phase 6 — Ahrefs pre-pass for draft-section.
 *
 * Runs a small unconstrained HAIKU call (budget: 3 Ahrefs tool calls) before
 * the forced-tool draft call. Lets the model verify DR for candidate citation
 * domains and check keyword data for related terms. The result is injected as
 * an AHREFS_RESEARCH_CONTEXT block into draft-section's system prompt so the
 * forced draft call can act on pre-verified authority data.
 *
 * Non-blocking: returns null on any error (missing key, network failure, bad JSON).
 * Skipped entirely for revision passes — revisions refine prose, not citations.
 */
async function runAhrefsPrePass(opts: {
  topic: string;
  keyword: string;
  brandId: string;
  projectId: string;
  suggestedDomains: string[];
}): Promise<AhrefsPrePassResult | null> {
  if (!process.env["AHREFS_MCP_KEY"]) return null;
  try {
    const { topic, keyword, brandId, projectId, suggestedDomains } = opts;
    const domainHint = suggestedDomains.length
      ? `\n\nCandidate citation domains to verify (check these first): ${suggestedDomains.slice(0, 5).join(", ")}`
      : "";
    const systemPrompt =
      `You are gathering research context for an article on "${topic}" targeting the keyword "${keyword}". ` +
      `Use Ahrefs tools to verify Domain Rating for up to 3 candidate citation domains that fit this article. ` +
      `Also check keyword data for 1-2 candidate related keywords if useful. ` +
      `Return findings as JSON only, no markdown fences: ` +
      `{"citation_candidates":[{"domain":"...","dr":0,"ur":0,"is_authoritative":false}],"keyword_context":[{"keyword":"...","volume":0,"difficulty":0}]}. ` +
      `is_authoritative is true when DR ≥ 80. Budget: 3 tool calls total.${domainHint}`;

    const data = await callAnthropicRaw(
      {
        model: HAIKU,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: "user", content: "Gather Ahrefs data now and return the JSON." }],
      },
      { toolContext: { brandId, projectId }, ahrefsBudget: 3 },
    );

    const textBlock = ((data.content as any[]) ?? []).find((b: any) => b.type === "text");
    if (!textBlock?.text) return null;
    const raw = (textBlock.text as string).replace(/```[a-z]*\n?/gi, "").trim();
    const parsed = JSON.parse(raw) as AhrefsPrePassResult;
    if (!Array.isArray(parsed.citation_candidates)) return null;
    return parsed;
  } catch {
    return null;
  }
}

router.post("/draft-section", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id, section_id, revision_instruction } = req.body as {
      project_id?: string; section_id?: string; revision_instruction?: string;
    };
    if (!project_id || !section_id) { res.status(400).json({ error: "project_id and section_id required" }); return; }
    const brandId = resolvedRequestBrand(req);

    const [projectRows, outlineRows, proofRows, briefRows, existingRows] = await Promise.all([
      db.select().from(projectsTable).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1),
      db.select().from(outlinesTable).where(and(eq(outlinesTable.projectId, project_id), eq(outlinesTable.brandId, brandId))).limit(1),
      db.select().from(proofPointsTable).where(and(eq(proofPointsTable.projectId, project_id), eq(proofPointsTable.brandId, brandId), eq(proofPointsTable.starred, true))),
      db.select({ synergyMap: researchBriefsTable.synergyMap, conversionSignals: researchBriefsTable.conversionSignals, aiCitationLandscape: researchBriefsTable.aiCitationLandscape, atomicQuestionMap: researchBriefsTable.atomicQuestionMap, entityDataRequirements: researchBriefsTable.entityDataRequirements, updatedAt: researchBriefsTable.updatedAt }).from(researchBriefsTable).where(and(eq(researchBriefsTable.projectId, project_id), eq(researchBriefsTable.brandId, brandId))).limit(1),
      db.select().from(draftsTable).where(and(eq(draftsTable.projectId, project_id), eq(draftsTable.brandId, brandId), eq(draftsTable.sectionId, section_id))).limit(1),
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

    const draftIcp = Array.isArray(project.icps) && project.icps.length ? (project.icps[0] as number) : undefined;
    // Phase 6: pre-pass runs concurrently with asset-candidate fetch.
    // Seed candidate domains from the already-normalized whitelist sources.
    const suggestedDomains = whitelist.sources.slice(0, 5).map((s) => s.host);
    const [{ block: draftAssetBlock, linkHosts: draftLinkHosts }, ahrefsPrePass] = await Promise.all([
      buildAssetCandidates({
        brandId: project.brandId,
        icp: draftIcp,
        funnelStage: project.funnelStage || undefined,
      }),
      revision_instruction
        ? Promise.resolve(null)
        : runAhrefsPrePass({
            topic: project.topic || "",
            keyword: project.keyword || "",
            brandId: project.brandId,
            projectId: project_id,
            suggestedDomains,
          }),
    ]);
    // Authority-citation domains and internal-link target hosts must survive
    // enforceCitationWhitelist below, or the asset-derived citations (#16) and
    // internal links (#15) get stripped before they ever reach the validators.
    for (const d of AUTHORITY_WHITELIST) whitelist.hosts.add(d);
    for (const h of draftLinkHosts) whitelist.hosts.add(h);

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
- Inline citations MUST use the form [Publisher Name](https://real-url) where the URL is copied CHARACTER-FOR-CHARACTER from the whitelist above. NEVER construct, extend, or guess a URL — do not invent paths like "/statistics/1234..." on a whitelisted domain; a fabricated URL fails live verification and blocks ship.
- If a claim has no whitelisted source URL, state the point qualitatively WITHOUT a number and WITHOUT a citation rather than inventing either.
- Do not cite Wikipedia or AI-generated content even if it appears in the whitelist.

Banned phrases (do not use): "in today's fast-paced world", "in conclusion", "leverage", "synergy", "delve", "navigate the landscape", "game-changer", "unlock the power".

HEADING RULE — exactly one H1, no repeated section heading:
The article has EXACTLY ONE H1 — the title provided in the intake (shown above). Never emit H1 ("# ") tags inside section content. Do NOT include the section's own heading in your content — the stitch step inserts it automatically; starting your content with the section heading creates a duplicate H2 and blocks ship. Start your content directly with prose. Any sub-headings inside your section must be H3 ("### ").

KEYWORD EXCLUSIVITY RULE:
The exact primary keyword phrase may appear verbatim ONLY in the article's H1 title, the opening paragraph (first 100 words), and "## " H2 headings. It must NEVER appear verbatim in any section's body paragraphs — not even Section 1's. In all body text (including the closing section and FAQ answers), use natural variations — never the full exact phrase. Verbatim repetition of the keyword phrase across sections is flagged as cross-section repetition and blocks ship.

STATISTIC DENSITY RULE (validator-enforced, blocking):
At most ONE digit-based figure per paragraph AND per list item. A digit-based figure is: any dollar amount ("$45,000"), any percentage ("30%"), or any bare number of 100 or more ("1,200"). A range written with two digit figures ("$15,000–$50,000", "150–300%") counts as TWO and fails. To express a range: give ONE bound in digits and the other in words ("from $15,000 up to fifty thousand dollars"), or use a single anchor ("around $30,000", "under 25%"), or split the bounds across separate paragraphs / separate list items with a BLANK LINE between them. Small two-digit numbers ("15", "40 hours") and bare years ("2026") do not count.
Prose narrative should carry the paragraph. A statistic is punctuation, not the sentence.

BRAND VOICE — owning brand identity:
This article is written from the owning brand's perspective. You may use "we," "our team," and "our clients" — but EVERY occurrence of the words "we" or "our" counts as a brand mention against the funnel-stage cap:
- TOFU: max 1 brand mention per 12 sentences
- MOFU: max 1 brand mention per 8 sentences
- BOFU: max 1 brand mention per 5 sentences
This article's funnel stage: ${project.funnelStage || "unknown"}.
HARD BUDGET for this section: at most TWO sentences that use "we" or "our" — write everything else in third person or passive-free neutral voice. Exceeding the cap blocks ship. But do not go to zero: at least one brand mention somewhere in the article is required, so if this section is the natural place for a client story or CTA, spend the budget here.

${draftAssetBlock}
${ahrefsPrePass ? `=== AHREFS RESEARCH CONTEXT (pre-verified, cache-fresh) ===
Citation candidates (use DR/UR data to inform which domains to prioritize):
${JSON.stringify(ahrefsPrePass.citation_candidates, null, 2)}

Keyword context:
${JSON.stringify(ahrefsPrePass.keyword_context, null, 2)}

AUTHORITY RULE UPGRADE: When choosing external citations, prefer domains where is_authoritative=true (DR ≥ 80). Do not cite a domain from this list where is_authoritative=false unless no authoritative alternative exists.
=== END AHREFS RESEARCH CONTEXT ===` : ""}
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
${sectionIndex === 1
  ? `
OPENING KEYWORD RULE: The first 100 words of this section MUST contain the primary keyword: "${project.keyword}". Follow the direct-answer rule: the primary keyword appears in the first sentence, followed by a two-to-three-sentence direct answer.
`
  : sectionIndex === totalSections
    ? `
CLOSING SECTION RULE: This is the final (closing) section. Reference the topic using a close VARIANT of the primary keyword — do NOT repeat the exact phrase "${project.keyword}" verbatim (that verbatim phrase belongs to Section 1 only; repeating it across sections blocks ship).
`
    : ""}
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
5. HARD LIMIT — at most ONE numeric value per paragraph AND per list item. Numeric values are: dollar figures, percentages, and any number of 100 or more. A range like "$15,000 to $50,000" counts as TWO numeric values — give a single representative figure instead ("around $30,000") or split the endpoints across separate list items with a BLANK LINE between each item. Before returning, re-read every paragraph and bullet: if it carries more than one numeric value, cut or relocate. This is a blocking ship gate.
6. Any list of 3 or more parallel items (features, cost factors, steps, options) MUST be formatted as a markdown bullet or numbered list — never as a comma-separated run-on sentence. Leave a blank line between list items that contain numbers.
7. Never introduce a statistic from memory. Every statistic you state MUST carry an inline [Publisher](url) citation whose URL is copied EXACTLY from the whitelist or starred proof points — never a bare domain like "https://clutch.co" and never a constructed/invented path. If a number has no such source, CUT the number and make the point qualitatively. NEVER attribute a number to "industry standard", "internal data", "internal project data", or an unnamed analysis — those are automatically stripped and block ship. Spelling a number out in words does not exempt it from needing a verifiable source.
8. Internal links: only ever link to URLs that appear VERBATIM in the INTERNAL LINK TARGETS list in the project context. The anchor text MUST be copied WORD-FOR-WORD from one of the listed anchor variations for that URL — never paraphrase, shorten, or reword an anchor. Never link to a company-site URL from memory, and never link the same target URL twice in one section.

Produce real prose. Do not produce a brief. Then call submit_draft with:
- content: the full prose for this section, with inline [Publisher](url) citations
- citation_count: number of inline citations
- atomic_chunks_count: number of standalone liftable paragraphs
- schema_markup_recommendations: JSON-LD for any schema this section supports`;

    const userMessage = revision_instruction ? "Revise per the instruction above. Call submit_draft." : "Draft this section now. Call submit_draft.";
    const draftSubstage = revision_instruction ? `revise_section_${sectionIndex}` : `draft_section_${sectionIndex}`;
    const metadataUserId = buildAnthropicUserId({
      pod: project.pod,
      stage: "stage3",
      substage: `interview_${section_id}`,
      writer_id: project.writerId,
    });

    const { system, version: playbookVersion, included } = await buildRoutedSystemWithProject(
      "draft",
      project.brandId,
      projectContext,
      projectCacheTag,
      stageInstructions,
      project.playbookVersion,
    );
    req.log.info({ brandId: project.brandId, playbookVersion, sections: included, cacheTag: projectCacheTag }, "draft-section: routed playbook sections");

      const t0 = Date.now();
    const draftData = await callAnthropicRaw({
      model: SONNET,
      max_tokens: 4000,
      metadata: { user_id: metadataUserId },
      system,
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: "submit_draft" },
      messages: [{ role: "user", content: userMessage }],
    }, {
      toolContext: { brandId: project.brandId, projectId: project_id },
    });
    await logUsage({ project_id, brand_id: project.brandId, stage: "draft", sub_stage: section_id, model: SONNET, metadata_user_id: metadataUserId, usage: draftData.usage, duration_ms: Date.now() - t0, ok: true });

    const draftToolUse = (draftData.content || []).find((b: any) => b.type === "tool_use");
    if (!draftToolUse) throw new Error("No draft returned");
          const out = (md.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();

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
      await logUsage({ project_id, brand_id: project.brandId, stage: "draft", sub_stage: `${section_id}:review`, model: HAIKU, metadata_user_id: reviewMetaUserId, usage: reviewData.usage, duration_ms: Date.now() - t1, ok: true });
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
        voiceFlags: sanitizeVoiceFlags(review?.voice_flags),
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
          voiceFlags: sanitizeVoiceFlags(review?.voice_flags),
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

    await db.update(projectsTable).set({ currentStage: 3, status: "drafting" }).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId)));

    res.json({ ok: true, draft: { ...out, ...(review || {}) } });
  } catch (e) {
    req.log.error({ err: e }, "draft-section route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /api/ai/interview-step
 * ───────────────────────────────────────────────────────────── */
router.post("/interview-step", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id, section_id, last_answer } = req.body as {
      project_id?: string; section_id?: string; last_answer?: string;
    };
    if (!project_id || !section_id) { res.status(400).json({ error: "project_id and section_id required" }); return; }
    const brandId = resolvedRequestBrand(req);

    const [projectRows, outlineRows, priorRows] = await Promise.all([
      db.select().from(projectsTable).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1),
      db.select({ sections: outlinesTable.sections, h1: outlinesTable.h1 }).from(outlinesTable).where(and(eq(outlinesTable.projectId, project_id), eq(outlinesTable.brandId, brandId))).limit(1),
      db.select().from(interviewAnswersTable).where(and(eq(interviewAnswersTable.projectId, project_id), eq(interviewAnswersTable.brandId, brandId))).orderBy(interviewAnswersTable.createdAt),
    ]);
    const project = projectRows[0];
    const outline = outlineRows[0];
    const prior = priorRows;
    if (!project) { res.status(500).json({ error: "project not found" }); return; }

    const section = (outline?.sections as any[])?.find((s: any) => s.id === section_id);

    const interviewInstructions = `You are interviewing the writer to extract their voice and POV for the section "${section?.heading}" (job: ${section?.job}) of "${outline?.h1}". Ask ONE question at a time. Reactive, conversational. Build on prior answers. Use playbook ICP/voice context to ask sharper questions.`;
    const { system: routedSystem, version: playbookVersion, included } = await buildRoutedSystem(
      "interview",
      project.brandId,
      interviewInstructions,
      project.playbookVersion,
    );
    req.log.info({ brandId: project.brandId, playbookVersion, sections: included }, "interview-step: routed playbook sections");

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
      brand_id: project.brandId,
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

/* ── Phase 4: article-level structured output schema ─────────────────────────
 * ARTICLE_TOOL is extracted at final-stitch from the stitched article + brief
 * and validated by the Phase 5/6 validators. The case-study item schema has NO
 * contract_value field and `additionalProperties: false`, so a per-project
 * dollar amount is unconstructible at the schema layer (dispatch §4.1 / §6.6).
 */
const ARTICLE_TOOL = {
  name: "submit_article_schema",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title_tag: { type: "string" },
      h1: { type: "string" },
      meta_description: { type: "string" },
      opening_block: {
        type: "object",
        additionalProperties: false,
        properties: {
          first_100_words: { type: "string" },
          direct_answer: { type: "string" },
        },
        required: ["first_100_words", "direct_answer"],
      },
      closing_block: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      headings: {
        type: "object",
        additionalProperties: false,
        properties: {
          h2: { type: "array", items: { type: "string" } },
          h3: { type: "array", items: { type: "string" } },
        },
      },
      list_blocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            section: { type: "string" },
            type: { type: "string", enum: ["ordered", "unordered"] },
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
      cost_table: { type: "object" },
      timeline_table: { type: "object" },
      regional_rate_comparison: { type: "object" },
      hourly_rate_comparison: { type: "object" },
      team_model_comparison: { type: "object" },
      maintenance_cost_breakdown: { type: "object" },
      competitor_teardown: { type: "object" },
      case_studies_cited: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            project_name: { type: "string" },
            technical_narrative: { type: "string" },
            outcome: { type: "string" },
            in_playbook_or_bank: { type: "boolean" },
          },
          required: ["project_name", "technical_narrative"],
        },
      },
      local_entity_grounding: {
        type: "object",
        additionalProperties: false,
        properties: {
          city: { type: "string" },
          local_context_sentences: { type: "array", items: { type: "string" } },
        },
      },
      author_byline: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          credentials: { type: "string" },
          bio_link: { type: "string" },
        },
        required: ["name", "credentials", "bio_link"],
      },
      statistics_used: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim: { type: "string" },
            source_url: { type: "string" },
            source_name: { type: "string" },
            year: { type: "number" },
            verified_live: { type: "boolean" },
            flagged_as_stale: { type: "boolean" },
          },
          required: ["claim"],
        },
      },
      external_authority_citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            domain: { type: "string" },
            url: { type: "string" },
            purpose: { type: "string" },
          },
          required: ["domain", "url"],
        },
      },
      testimonials_used: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            reviewer_name: { type: "string" },
            company: { type: "string" },
            quote_excerpt: { type: "string" },
            source_url: { type: "string" },
            in_bank: { type: "boolean" },
          },
          required: ["reviewer_name", "company", "quote_excerpt"],
        },
      },
      internal_links: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            target_url: { type: "string" },
            anchor_text: { type: "string" },
            section: { type: "string" },
            in_link_targets: { type: "boolean" },
          },
          required: ["target_url", "anchor_text"],
        },
      },
      faq_schema: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
        },
      },
      cta_block: {
        type: "object",
        additionalProperties: false,
        properties: {
          placement: { type: "string" },
          anchor_text: { type: "string" },
          target_url: { type: "string" },
        },
      },
      lsi_used_in_body: { type: "array", items: { type: "string" } },
    },
    required: [
      "title_tag",
      "h1",
      "meta_description",
      "opening_block",
      "closing_block",
      "author_byline",
      "faq_schema",
    ],
  },
};

/** Money-bearing keys that may never ride on a case study (defense in depth). */
const CASE_STUDY_MONEY_KEYS = [
  "contract_value", "deal_value", "revenue", "budget", "price", "cost",
  "amount", "value_usd", "billing", "billed",
];

/** Decode escaped literals + strip control chars (mirrors sanitizeVoiceFlags). */
function safeText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/\\r\\n|\\n|\\r|\\t/g, " ")
    .replace(/\\"/g, '"')
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Phase 4.2 layer-2 sanitization for the extracted article schema. Coerces
 * shapes, decodes escape soup, and — critically — strips any money-bearing key
 * from each case study so a per-project dollar amount can never be persisted.
 */
function sanitizeArticleSchema(raw: any): ArticleSchema {
  const r = raw && typeof raw === "object" ? raw : {};
  const out: ArticleSchema = { ...r };

  out.case_studies_cited = asArray(r.case_studies_cited).map((cs: any) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cs || {})) {
      if (CASE_STUDY_MONEY_KEYS.includes(k.toLowerCase().replace(/[^a-z_]/g, ""))) continue;
      clean[k] = v;
    }
    return {
      project_name: safeText((clean as any).project_name),
      technical_narrative: safeText((clean as any).technical_narrative),
      ...((clean as any).outcome != null ? { outcome: safeText((clean as any).outcome) } : {}),
      ...((clean as any).in_playbook_or_bank != null ? { in_playbook_or_bank: !!(clean as any).in_playbook_or_bank } : {}),
    };
  });

  out.testimonials_used = asArray(r.testimonials_used).map((t: any) => ({
    reviewer_name: safeText(t?.reviewer_name),
    company: safeText(t?.company),
    quote_excerpt: safeText(t?.quote_excerpt),
    ...(t?.source_url ? { source_url: safeText(t.source_url) } : {}),
  }));

  out.internal_links = asArray(r.internal_links).map((l: any) => ({
    target_url: safeText(l?.target_url),
    anchor_text: safeText(l?.anchor_text),
    ...(l?.section ? { section: safeText(l.section) } : {}),
  }));

  out.statistics_used = asArray(r.statistics_used).map((s: any) => ({
    claim: safeText(s?.claim),
    ...(s?.source_url ? { source_url: safeText(s.source_url) } : {}),
    ...(s?.source_name ? { source_name: safeText(s.source_name) } : {}),
    ...(typeof s?.year === "number" ? { year: s.year } : {}),
  }));

  out.external_authority_citations = asArray(r.external_authority_citations).map((c: any) => ({
    domain: safeText(c?.domain),
    url: safeText(c?.url),
    ...(c?.purpose ? { purpose: safeText(c.purpose) } : {}),
  }));

  out.faq_schema = asArray(r.faq_schema).map((f: any) => ({
    question: safeText(f?.question),
    answer: safeText(f?.answer),
  }));

  return out;
}

/** Build brand-bound validator deps. Confidentiality loads FRESH per call (§6.4). */
function buildValidatorDeps(brandId: string, playbookVersion?: number | null): ValidatorDeps {
  return {
    isReviewInBank: (reviewer, company, quote) => isReviewInBank(brandId, reviewer, company, quote),
    getConfidentialCompanies: () => getConfidentialCompanies(brandId),
    isUrlInLinkTargets: (url) => isUrlInLinkTargets(brandId, url),
    getAnchorVariations: (url) => getAnchorVariations(brandId, url),
    getPlaybookProjectNames: () => getPlaybookProjectNames(brandId, playbookVersion),
    getReviewsBankProjectNames: () => getReviewsBankProjectNames(brandId),
    fetchUrl: async (url: string) => {
      // SSRF guard: validate every hop (manual redirects) against the public-IP
      // allowlist so a model-extracted source_url can't probe internal hosts.
      try {
        let current = url;
        for (let hop = 0; hop < 4; hop++) {
          if (!(await isSafePublicUrl(current))) return { ok: false, status: 0, text: "" };
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          const resp = await fetch(current, { signal: ctrl.signal, redirect: "manual" });
          clearTimeout(timer);
          if (resp.status >= 300 && resp.status < 400) {
            const loc = resp.headers.get("location");
            if (!loc) return { ok: false, status: resp.status, text: "" };
            current = new URL(loc, current).toString();
            continue;
          }
          const text = resp.ok ? (await resp.text()).slice(0, 200000) : "";
          return { ok: resp.ok, status: resp.status, text };
        }
        return { ok: false, status: 0, text: "" };
      } catch {
        return { ok: false, status: 0, text: "" };
      }
    },
  };
}

router.post("/final-stitch", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const { project_id } = req.body as { project_id?: string };
    if (!project_id) { res.status(400).json({ error: "project_id required" }); return; }
    const brandId = resolvedRequestBrand(req);

    const [projectRows, outlineRows, draftRows, briefRows] = await Promise.all([
      db.select({ id: projectsTable.id, brandId: projectsTable.brandId, brandName: brandsTable.name, playbookVersion: projectsTable.playbookVersion, keyword: projectsTable.keyword, contentType: projectsTable.contentType, funnelStage: projectsTable.funnelStage, icps: projectsTable.icps, serpSignals: projectsTable.serpSignals, lsiRetrieved: projectsTable.lsiRetrieved }).from(projectsTable).innerJoin(brandsTable, eq(projectsTable.brandId, brandsTable.id)).where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId))).limit(1),
      db.select().from(outlinesTable).where(and(eq(outlinesTable.projectId, project_id), eq(outlinesTable.brandId, brandId))).limit(1),
      db.select().from(draftsTable).where(and(eq(draftsTable.projectId, project_id), eq(draftsTable.brandId, brandId))),
      db.select({ atomicQuestionMap: researchBriefsTable.atomicQuestionMap, entityDataRequirements: researchBriefsTable.entityDataRequirements, aiCitationLandscape: researchBriefsTable.aiCitationLandscape }).from(researchBriefsTable).where(and(eq(researchBriefsTable.projectId, project_id), eq(researchBriefsTable.brandId, brandId))).limit(1),
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

    /* Cut B safety net: drafts must not repeat their own section heading —
     * if a draft's content starts with a heading line matching its section
     * heading (any level), strip it so the stitched article has one H2 per
     * section. */
    const normHeading = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    let stitched = `# ${(outline as any).h1}\n\n`;
    for (const d of ordered) {
      let content = String(d.content || "").trimStart();
      const m = content.match(/^(#{1,3})\s+(.+)\n?/);
      if (m && normHeading(m[2]!) === normHeading(String(d.sectionHeading || ""))) {
        content = content.slice(m[0].length).trimStart();
      }
      stitched += `## ${d.sectionHeading}\n\n${content}\n\n`;
    }

    /* Cut B Fix 1 safety net: EXACTLY one H1 in the assembled article.
     * The prompt instruction is the primary fix; if section content still
     * emitted H1s, demote every H1 beyond the first to H2 and warn. */
    {
      const lines = stitched.split("\n");
      let seenH1 = false;
      let demoted = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/^#\s/.test(lines[i]!)) {
          if (seenH1) {
            lines[i] = `#${lines[i]!}`;
            demoted++;
          } else {
            seenH1 = true;
          }
        }
      }
      if (demoted > 0) {
        stitched = lines.join("\n");
        req.log.warn({ demoted }, "final-stitch: demoted extra H1 heading(s) to H2");
      }
    }

    /* Cut B Fix 7: cross-section repetition scan + rewrite pass.
     * Detect verbatim 8+ word phrases repeating across sections; if found,
     * run a revision call that rewrites the later occurrence(s) while
     * preserving meaning, then RE-SCAN and repeat up to 3 passes (a single
     * pass routinely leaves or reintroduces repeats).
     * Non-fatal: on any failure, keep the current text. */
    const countDensityOffenders = (md: string): number => {
      const text = md
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/[*_`>|]/g, "");
      let offenders = 0;
      for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
        const stats = (para.match(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]{2,}\b/g) || [])
          .filter((t: string) => !/^\d{4}$/.test(t.replace(/[^\d]/g, "")));
        if (stats.length > 1) offenders++;
      }
      return offenders;
    };
    for (let rwPass = 1; rwPass <= 3; rwPass++) {
      const repeatedPhrases = findCrossSectionRepetitions(stitched);
      const densityOffenders = countDensityOffenders(stitched);
      if (repeatedPhrases.length === 0 && densityOffenders === 0) break;
      try {
        const tRw = Date.now();
        const rwMetaUserId = buildAnthropicUserId({ pod: (project as any).pod, stage: "final-stitch", substage: `repetition-rewrite-${rwPass}`, writer_id: (project as any).writerId });
        const rwSystem = `You are revising an assembled article before finalizing. The listed phrases of 8 or more words repeat verbatim across sections. For EACH listed phrase, keep the FIRST occurrence and rewrite every later occurrence with genuinely different wording while preserving the meaning — reordering two words is not enough; the rewritten passage must share no 8-word run with the original. KEYWORD PLACEMENT (do not break it): the primary keyword "${(project as any).keyword || ""}" MUST remain verbatim in the H1 and in the first 100 words of the body — NEVER reword the opening paragraph's keyword occurrence. After the first "## " heading, replace verbatim keyword occurrences in paragraph text and "### " subheadings with a natural variation. NUMERIC DENSITY: every paragraph may carry at most ONE numeric value (dollar figure, percentage, or number of 100+, excluding bare years) — if a paragraph has more, keep the most important one WITH its citation and move each extra number (with its own citation) to its own list item separated by blank lines, or cut the extra number entirely. NEVER convert a cited number into spelled-out words and NEVER drop, shorten, or alter any [Publisher](url) citation or its URL — every markdown link URL in the original must appear unchanged in your output. Do not delete content — rewrite. Do not change H1 ("# ") or H2 ("## ") headings or quotes. H3 ("### ") question-style subheadings (e.g. FAQ questions) MAY be reworded when they contain a repeated phrase or the verbatim keyword. Return ONLY the full revised article in Markdown, with no preamble or commentary.`;
        const rwUser = `Repeated phrases detected (normalized to lowercase words):\n${repeatedPhrases.length ? repeatedPhrases.map((p) => `- "${p}"`).join("\n") : "(none — this pass is for the numeric-density rule only)"}\n\nParagraphs carrying more than one numeric value: ${densityOffenders}\n\nARTICLE (Markdown):\n${stitched}`;
        const rwData = await callAnthropicRaw({
          model: SONNET,
          max_tokens: 16000,
          metadata: { user_id: rwMetaUserId },
          system: rwSystem,
          messages: [{ role: "user", content: rwUser }],
        }, {
          toolContext: { brandId: (project as any).brandId, projectId: project_id },
        });
        await logUsage({ project_id, brand_id: project.brandId, stage: "final-stitch", sub_stage: `repetition-rewrite-${rwPass}`, model: SONNET, metadata_user_id: rwMetaUserId, usage: rwData.usage, duration_ms: Date.now() - tRw, ok: true });
        const rwText = (rwData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
        const countH2 = (s: string) => (s.match(/^## /gm) || []).length;
        /* Invariant guards: the rewrite must not break keyword placement or
         * alter/drop any markdown link URL — reject the pass otherwise. */
        const kwNorm = String((project as any).keyword || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
          const first100 = stitched
            .replace(/^#\s.*$/m, "")
            .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^[-*+]\s+/gm, "")
            .replace(/^\d+\.\s+/gm, "")
            .replace(/[*_`>|]/g, "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 100)
            .join(" ");
        const kwInFirst100 = (md: string) => !kwNorm || first100(md).includes(kwNorm);
        const kwInH2 = (md: string) => !kwNorm || (md.match(/^##\s+.*$/gm) || []).some((h) => normText(h).includes(kwNorm));
        const linkUrlSet = (md: string) =>
          new Set(
            (md.match(/\]\(([^)]+)\)/g) || []).map((m) =>
              m.slice(2, -1).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""),
            ),
          );
        const origUrls = linkUrlSet(stitched);
        const newUrls = linkUrlSet(rwText);
          const invented = [...paraLinkSet(out)].filter((u) => !origLinks.has(u));
          const dropped = [...origLinks].filter((u) => !newLinks.has(u));
        const urlsOk = invented.length === 0 && dropped.length <= 2;
        const kw100Ok = kwInFirst100(rwText) || !kwInFirst100(stitched);
        const kwH2Ok = kwInH2(rwText) || !kwInH2(stitched);
        const invariantsOk = kw100Ok && kwH2Ok && urlsOk;
        if (!invariantsOk) {
          req.log.warn({ pass: rwPass, kw100Ok, kwH2Ok, invented, dropped }, "final-stitch: repetition rewrite violated invariants; keeping original");
          continue;
        }
        const rwReps = findCrossSectionRepetitions(rwText).length;
        const rwDensity = countDensityOffenders(rwText);
        const improves =
          (repeatedPhrases.length === 0 || rwReps < repeatedPhrases.length) &&
          rwDensity <= Math.max(densityOffenders, 0) &&
          rwReps <= repeatedPhrases.length;
        if (!improves) {
          req.log.warn({ pass: rwPass, rwReps, wasReps: repeatedPhrases.length, rwDensity, wasDensity: densityOffenders }, "final-stitch: repetition rewrite did not improve counters; keeping original");
          continue;
        }
        if (
          rwText.length >= stitched.length * 0.7 &&
          rwText.length <= stitched.length * 1.4 &&
          (rwText.match(/^#\s/gm) || []).length === 1 &&
          countH2(rwText) === countH2(stitched)
        ) {
          stitched = rwText;
          req.log.info({ pass: rwPass, phrases: repeatedPhrases.length }, "final-stitch: repetition rewrite applied");
          /* Provenance: one row per rewritten phrase (audit trail for Fix 7). */
          try {
            await db.insert(moduleDataProvenanceTable).values(
              repeatedPhrases.map((phrase) => ({
                brandId: project.brandId,
                entityType: "draft_score",
                entityId: project_id,
                sourceModule: "content-forge",
                generationMethod: "repetition-rewrite",
                metadata: { phrase, pass: rwPass, action: "rewrote-subsequent-occurrence" },
              })),
            );
          } catch (e) {
            req.log.warn({ err: e }, "final-stitch: repetition-rewrite provenance insert failed (non-fatal)");
          }
        } else {
          req.log.warn({ pass: rwPass, gotChars: rwText.length, wantAtLeast: Math.round(stitched.length * 0.7) }, "final-stitch: repetition rewrite failed sanity check; keeping original");
          break;
        }
      } catch (e) {
        req.log.warn({ err: e }, "final-stitch: repetition rewrite failed (non-fatal)");
        break;
      }
    }

    /* Surgical net for matrix #22 (cross-section repetition) and #21 (stat
     * density): micro-rewrite ONLY the offending paragraphs, splice each
     * replacement back deterministically, and validate every splice against
     * the mirrored validator counters before accepting it. */
    try {
      const normWords = (s: string) =>
        s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");
      const paraLinkSet = (s: string) => new Set((s.match(/\]\(([^)]+)\)/g) || []).map((m) => m.slice(2, -1).trim()));
      const paraStatCount = (s: string) => {
        const text = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>|]/g, "");
        return (text.match(/\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]{2,}\b/g) || [])
          .filter((t: string) => !/^\d{4}$/.test(t.replace(/[^\d]/g, ""))).length;
      };
      type MicroFix = { para: string; instructions: string; requireSameLinks: boolean; check: (out: string) => boolean };
      const microFixes: MicroFix[] = [];

      const remaining = findCrossSectionRepetitions(stitched);
      if (remaining.length) {
        const parts = stitched.split(/^## /m);
        const bodyOf = (part: string, idx: number) => (idx === 0 ? part : part.split("\n").slice(1).join("\n"));
        const firstIdx = new Map<string, number>();
        parts.forEach((part, idx) => {
            const norm = normWords(para);
          for (const ph of remaining) if (!firstIdx.has(ph) && norm.includes(ph)) firstIdx.set(ph, idx);
        });
        const seen = new Set<string>();
        parts.forEach((part, idx) => {
          for (const para of bodyOf(part, idx).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
            if (/^#\s/.test(para) || seen.has(para)) continue;
            const norm = normWords(para);
            const hits = remaining.filter((ph) => norm.includes(ph) && (firstIdx.get(ph) ?? 0) < idx);
            if (!hits.length) continue;
            seen.add(para);
            microFixes.push({
              para,
              instructions: `Rewrite this Markdown paragraph (or subheading) with genuinely different wording so that it no longer contains ANY of the following word sequences (comparison ignores case and punctuation). Preserve the meaning and approximate length. Keep every [text](url) markdown link EXACTLY as-is — same anchor text, same URL. Do NOT add any new links or URLs. STRUCTURE: keep exactly the input's structure — if the input is a plain paragraph, return a plain paragraph with NO "#" heading markers; if it starts with "### ", keep exactly "### ".\n${hits.map((p) => `- "${p}"`).join("\n")}`,
              requireSameLinks: true,
              check: (out) => hits.every((ph) => !normWords(out).includes(ph)),
            });
          }
        });
      }

      for (const para of stitched.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
        if (paraStatCount(para) <= 1 || /^#{1,6}\s/.test(para)) continue;
        microFixes.push({
          para,
          instructions: `This Markdown paragraph carries more than one digit-based figure (a dollar amount like "$45,000", a percentage like "30%", or a bare number of 100 or more; two-digit numbers and bare years like "2026" do NOT count). The paragraph must end up with AT MOST ONE digit-based figure. Choose whichever ONE figure is most important and keep it in digits. For every OTHER figure, do ONE of these: (a) if it is the other end of a range, rewrite the bound in words (e.g. "$15,000 and over $300,000" → "$15,000 up to roughly three hundred thousand dollars"); (b) otherwise remove it entirely and describe the point qualitatively. Spelled-out numbers ("three hundred thousand", "thirty percent") do not count against the limit. Keep any markdown citation links already in the paragraph exactly as-is — same anchor text, same URL. NEVER invent, add, or alter a link or URL, and NEVER emit placeholder links like [Publisher](url). STRUCTURE: return a plain paragraph with NO "#" heading markers (unless the input itself starts with heading markers — then keep them identical). Preserve the meaning and approximate length.`,
          requireSameLinks: false,
          check: (out) => paraStatCount(out) <= 1,
        });
      }

      let applied = 0;
      for (const [i, mf] of microFixes.slice(0, 8).entries()) {
        if (!stitched.includes(mf.para)) continue;
        try {
          const tMicro = Date.now();
          const microUserId = buildAnthropicUserId({ pod: (project as any).pod, stage: "final-stitch", substage: `density-repair-${round}`, writer_id: (project as any).writerId });
          const md = await callAnthropicRaw({
            model: SONNET,
            max_tokens: 2000,
            metadata: { user_id: microUserId },
            system: "You are surgically revising ONE paragraph of a finished article. Return ONLY the revised paragraph in Markdown — no preamble, no quotes, no commentary.",
            messages: [{ role: "user", content: `${densityInstructions}\n\nPARAGRAPH:\n${offender}` }],
          });
          await logUsage({ project_id, brand_id: project.brandId, stage: "final-stitch", sub_stage: `density-repair-${round}`, model: SONNET, metadata_user_id: microUserId, usage: md.usage, duration_ms: Date.now() - tMicro, ok: true });
          const out = (md.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
          if (!out || out.length < offender.length * 0.3 || out.length > offender.length * 2.5) {
            req.log.warn({ round, gotChars: out.length }, "final-stitch: density repair length out of bounds; stopping");
            break;
          }
          const origLinks = paraLinkSet(offender);
          const newLinks = paraLinkSet(out);
          const invented = [...paraLinkSet(out)].filter((u) => !origLinks.has(u));
          const dropped = [...origLinks].filter((u) => !newLinks.has(u));
          const linksOk = invented.length === 0 && (!mf.requireSameLinks || dropped.length === 0);
          if (!linksOk || !mf.check(out)) {
            req.log.warn({ fix: i + 1, invented, dropped, checkOk: mf.check(out) }, "final-stitch: surgical rewrite violated constraints; skipped");
            continue;
          }
          /* Structure guards: the replacement must keep the same heading level
           * (or stay a plain paragraph) and must not add or remove H1s. */
          const headPrefix = (s: string) => (s.match(/^(#{1,6})\s/) || [])[1] || "";
          if (headPrefix(out) !== headPrefix(mf.para)) {
            req.log.warn({ fix: i + 1, wasPrefix: headPrefix(mf.para), gotPrefix: headPrefix(out) }, "final-stitch: surgical rewrite changed heading level; skipped");
            continue;
          }
          const candidate = stitched.replace(offender, out);
          const h1Count = (s: string) => (s.match(/^#\s/gm) || []).length;
          const kwLower = String((project as any).keyword || "").trim().toLowerCase();
          const bodyFirstWords = (s: string) =>
            s.replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>|]/g, "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 120).join(" ");
          const kwEarlyPreserved = !kwLower2 || !bodyFirstWords2(stitched).includes(kwLower2) || bodyFirstWords2(candidate).includes(kwLower2);
          if (
            h1Count(candidate) !== h1Count(stitched) ||
            !kwEarlyPreserved ||
            findCrossSectionRepetitions(candidate).length > findCrossSectionRepetitions(stitched).length ||
            countDensityOffenders(candidate) > countDensityOffenders(stitched)
          ) {
            req.log.warn({ fix: i + 1, kwEarlyPreserved, h1Was: h1Count(stitched), h1Got: h1Count(candidate) }, "final-stitch: surgical rewrite regressed global counters; skipped");
            continue;
          }
          stitched = candidate;
          applied++;
        } catch (e) {
          req.log.warn({ err: e, fix: i + 1 }, "final-stitch: surgical rewrite call failed (non-fatal)");
        }
      }

      /* Density repair pass: a paragraph can be BOTH a repetition offender and
       * a density offender. The repetition fix above rewrites it first, which
       * invalidates the density fix's captured text (silent no-op). So here we
       * recompute density offenders from the LIVE `stitched` and repair each
       * one, up to a small cap, with the same safety guards. */
      const densityInstructions = `This Markdown paragraph carries more than one digit-based figure (a dollar amount like "$45,000", a percentage like "30%", or a bare number of 100 or more; two-digit numbers and bare years like "2026" do NOT count). The paragraph must end up with AT MOST ONE digit-based figure. Choose whichever ONE figure is most important and keep it in digits. For every OTHER figure, do ONE of these: (a) if it is the other end of a range, rewrite the bound in words (e.g. "$15,000 and over $300,000" → "$15,000 up to roughly three hundred thousand dollars"); (b) otherwise remove it entirely and describe the point qualitatively. Spelled-out numbers ("three hundred thousand", "thirty percent") do not count against the limit. Keep any markdown citation links already in the paragraph exactly as-is — same anchor text, same URL. NEVER invent, add, or alter a link or URL, and NEVER emit placeholder links like [Publisher](url). STRUCTURE: return a plain paragraph with NO "#" heading markers (unless the input itself starts with heading markers — then keep them identical). Preserve the meaning and approximate length.`;
      const headPrefix2 = (s: string) => (s.match(/^(#{1,6})\s/) || [])[1] || "";
      const h1Count2 = (s: string) => (s.match(/^#\s/gm) || []).length;
      const kwLower2 = String((project as any).keyword || "").trim().toLowerCase();
      const bodyFirstWords2 = (s: string) =>
        s.replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[*_`>|]/g, "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 120).join(" ");
      let densityRepairs = 0;
      for (let round = 1; round <= 6 && countDensityOffenders(stitched) > 0; round++) {
        const offender = stitched
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean)
          .find((p) => !/^#{1,6}\s/.test(p) && paraStatCount(p) > 1);
        if (!offender) break;
        try {
          const tMicro = Date.now();
          const microUserId = buildAnthropicUserId({ pod: (project as any).pod, stage: "final-stitch", substage: `density-repair-${round}`, writer_id: (project as any).writerId });
          const md = await callAnthropicRaw({
            model: SONNET,
            max_tokens: 2000,
            metadata: { user_id: microUserId },
            system: "You are surgically revising ONE paragraph of a finished article. Return ONLY the revised paragraph in Markdown — no preamble, no quotes, no commentary.",
            messages: [{ role: "user", content: `${densityInstructions}\n\nPARAGRAPH:\n${offender}` }],
          });
          await logUsage({ project_id, brand_id: project.brandId, stage: "final-stitch", sub_stage: `density-repair-${round}`, model: SONNET, metadata_user_id: microUserId, usage: md.usage, duration_ms: Date.now() - tMicro, ok: true });
          const out = (md.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
          if (!out || out.length < offender.length * 0.3 || out.length > offender.length * 2.5) {
            req.log.warn({ round, gotChars: out.length }, "final-stitch: density repair length out of bounds; stopping");
            break;
          }
          const origLinks = paraLinkSet(offender);
          const invented = [...paraLinkSet(out)].filter((u) => !origLinks.has(u));
          if (invented.length || paraStatCount(out) > 1 || headPrefix2(out) !== headPrefix2(offender)) {
            req.log.warn({ round, invented, statsLeft: paraStatCount(out) }, "final-stitch: density repair violated constraints; stopping");
            break;
          }
          const candidate = stitched.replace(offender, out);
          const kwEarlyPreserved = !kwLower2 || !bodyFirstWords2(stitched).includes(kwLower2) || bodyFirstWords2(candidate).includes(kwLower2);
          if (
            h1Count2(candidate) !== h1Count2(stitched) ||
            !kwEarlyPreserved ||
            findCrossSectionRepetitions(candidate).length > findCrossSectionRepetitions(stitched).length ||
            countDensityOffenders(candidate) >= countDensityOffenders(stitched)
          ) {
            req.log.warn({ round, kwEarlyPreserved }, "final-stitch: density repair regressed counters; stopping");
            break;
          }
          stitched = candidate;
          densityRepairs++;
        } catch (e) {
          req.log.warn({ err: e, round }, "final-stitch: density repair call failed (non-fatal)");
          break;
        }
      }

      if (microFixes.length || densityRepairs) {
        req.log.info(
          { planned: microFixes.length, applied, densityRepairs, repetitionsLeft: findCrossSectionRepetitions(stitched).length, densityLeft: countDensityOffenders(stitched) },
          "final-stitch: surgical rewrite net finished",
        );
      }
    } catch (e) {
      req.log.warn({ err: e }, "final-stitch: surgical rewrite net failed (non-fatal)");
    }

    const word_count = stitched.split(/\s+/).filter(Boolean).length;
    const lower = filename.toLowerCase();
    const configuredBannedPhrases = await getBannedPhrases(project.brandId, project.playbookVersion);
    const bannedPhrases: string[] = configuredBannedPhrases.length > 0 ? configuredBannedPhrases : BANNED_PHRASES;
    const banned_phrase_count = bannedPhrases.reduce((n, p) => n + (lower.split(p.toLowerCase()).length - 1), 0);
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

    /* ── Phase 4/6: extract the article schema, then validate & gate ─────── */
    const primaryKeyword = String((project as any).keyword || "");
    const lsiRetrieved: string[] = Array.isArray((project as any).lsiRetrieved)
      ? ((project as any).lsiRetrieved as any[]).map((t: any) => (typeof t === "string" ? t : t?.keyword || t?.term || "")).filter(Boolean)
      : [];
    const lsiCov = computeLsiCoverage(lsiRetrieved, stitched);

    let articleSchema: ArticleSchema | null = null;
    let validation: any = null;
    let extraction_failed = false;
    try {
      const t0 = Date.now();
      const fsIcp = Array.isArray((project as any).icps) && (project as any).icps.length ? ((project as any).icps[0] as number) : undefined;
      const { block: stitchAssetBlock, linkTargetList: stitchLinkTargets } = await buildAssetCandidates({
        brandId: project.brandId,
        icp: fsIcp,
        funnelStage: String((project as any).funnelStage || "") || undefined,
      });
      const credentialsFromPlaybook = (await getCredentialBlock(project.brandId, project.playbookVersion)).replace(/\s+/g, " ").trim().slice(0, 300);
      const extractSystem = `You extract a structured publishing schema from a finished article. Return ONLY a submit_article_schema tool call. Use the exact primary keyword "${primaryKeyword}" where required. Never invent dollar amounts. When populating testimonials_used, internal_links, and external_authority_citations, copy values VERBATIM from the APPROVED ASSET CANDIDATES below — never invent a reviewer, company, quote, URL, or citation domain; omit any asset that is not present both in the article and in the candidate lists.

CASE STUDY RULE: case_studies_cited may ONLY contain case studies whose project/client name appears VERBATIM in the APPROVED ASSET CANDIDATES below (a testimonial's company or project name counts). NEVER invent, generalize, or anonymize a project name (e.g. "Healthcare Telehealth Platform") — an unrecognized name is stripped and BLOCKS SHIP, while an EMPTY case_studies_cited array PASSES. If the article's case narratives don't use an approved name, return an empty array. Never include a contract value or any dollar figure in a case study; rewrite the text without the number.

STATISTICS RULE: statistics_used may ONLY contain statistics that carry an inline [Publisher](url) citation in the article whose URL is a FULL deep link to a specific page. Copy that exact URL into source_url. OMIT any statistic whose source is a bare domain (e.g. "https://clutch.co"), "industry standard", "internal data", or any unnamed analysis — every entry is fetched live and stripped on failure, and one stripped entry BLOCKS SHIP. A short verified list beats a long unverified one.

INTERNAL LINKS RULE: internal_links must contain between 3 and 5 entries, each copied VERBATIM (URL + anchor) from the APPROVED ASSET CANDIDATES and actually present in the article. anchor_text must be copied WORD-FOR-WORD from one of the listed anchor variations for that URL — never paraphrase, shorten, or invent anchor text; a paraphrased anchor gets the entry stripped. List each target URL at most once. If more than 5 approved links appear in the article, keep the 5 strongest. Never list a URL that is not in the candidates — it gets stripped and can push the kept count below 3.

H1 RULE: The article has EXACTLY ONE H1 — the article's title. The h1 field must be that single title. Never derive or invent additional H1 tags.

CLOSING KEYWORD RULE: closing_block.summary MUST contain the exact-match primary keyword "${primaryKeyword}" at least once. faq_schema must reference the primary keyword in at least one question.

META DESCRIPTION RULE: meta_description must be BETWEEN 150 AND 155 characters. Aim for 152–153 characters so that a one-character miscount still lands inside the window. Count the characters of your candidate meta description one by one before emitting it. If it is longer than 155, cut; if shorter than 150, add. Include the primary keyword.

FAQ RULE: faq_schema must contain BETWEEN 3 AND 5 question/answer pairs — never more, never fewer; prefer 5 when the article supports it. Each answer must be 40–60 words — COUNT the words of every answer before emitting; aim for 45–55 so a miscount still lands inside the window. Do NOT copy the article's FAQ answers verbatim when they run long — CONDENSE each one to 45–55 words. Any answer over 60 or under 40 words is a hard failure.

OPENING BLOCK RULE: opening_block.first_100_words must be the VERBATIM first 100 words of the article body (everything after the H1, markdown formatting stripped) — copy them exactly, do not paraphrase or summarize.

DIRECT ANSWER RULE: opening_block.direct_answer must be EXACTLY 2 to 3 complete sentences (never a single sentence, never more than 3) that directly answer the primary keyword's question with the article's headline figures.

AUTHOR BYLINE RULE: author_byline is REQUIRED. Emit exactly:
{"name": ${JSON.stringify(`By the ${project.brandName} team`)}, "credentials": ${JSON.stringify(credentialsFromPlaybook)}, "bio_link": "/about"}
Do not omit any field. Do not modify the name.`;
      const extractUser = `PRIMARY KEYWORD: ${primaryKeyword}\n\n${stitchAssetBlock}\n\nARTICLE (Markdown):\n${stitched.slice(0, 60000)}`;
      const exData = await callAnthropicRaw({
        model: SONNET,
        max_tokens: 8000,
        system: extractSystem,
        tools: [ARTICLE_TOOL],
        tool_choice: { type: "tool", name: "submit_article_schema" },
        messages: [{ role: "user", content: extractUser }],
      });
      await logUsage({ project_id, brand_id: project.brandId, stage: "final-stitch", sub_stage: "article-schema-extract", model: SONNET, metadata_user_id: buildAnthropicUserId({ pod: (project as any).pod, stage: "final-stitch", substage: "article-schema-extract", writer_id: (project as any).writerId }), usage: exData.usage, duration_ms: Date.now() - t0, ok: true });
      const exTool = (exData.content || []).find((b: any) => b.type === "tool_use");
      if (exTool?.input) {
        const sanitized = sanitizeArticleSchema(exTool.input);
        /* Cut B safety net: meta_description must land in 150–155 chars.
         * If the model overshoots, trim at a word boundary down to ≤155;
         * keep the trim only if it stays ≥150. */
        if (typeof sanitized.meta_description === "string" && sanitized.meta_description.length > 155) {
          const original = sanitized.meta_description;
          let meta = original.slice(0, 155);
          meta = meta.replace(/\s+\S*$/, "").replace(/[\s,;:—-]+$/, "");
          if (!/[.!?]$/.test(meta) && meta.length <= 154) meta += ".";
          if (meta.length >= 150 && meta.length <= 155) {
            sanitized.meta_description = meta;
          } else {
            /* Word-boundary trim fell below 150 — fall back to a hard cut at
             * 155 chars (guaranteed inside the 150–155 window). */
            sanitized.meta_description = original.slice(0, 155).trimEnd();
          }
        }
        /* Cut B safety net: FAQ answers must be 40–60 words. First try to
         * TRIM overlong answers by dropping trailing sentences (accept the
         * trim only if it lands in 40–60 words); then drop any remaining
         * out-of-range pairs as long as at least 3 valid pairs remain. */
        if (Array.isArray(sanitized.faq_schema)) {
          const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
          sanitized.faq_schema = (sanitized.faq_schema as any[]).map((f: any) => {
            const answer = String(f?.answer || "").trim();
            if (wordCount(answer) <= 60) return f;
            const sentences = answer.split(/(?<=[.!?])\s+/);
            let kept = sentences.slice();
            while (kept.length > 1 && wordCount(kept.join(" ")) > 60) kept = kept.slice(0, -1);
            const trimmed = kept.join(" ");
            const w = wordCount(trimmed);
            return w >= 40 && w <= 60 ? { ...f, answer: trimmed } : f;
          });
          if ((sanitized.faq_schema as any[]).length > 3) {
            const inRange = (sanitized.faq_schema as any[]).filter((f: any) => {
              const w = wordCount(String(f?.answer || ""));
              return w >= 40 && w <= 60;
            });
            if (inRange.length >= 3 && inRange.length < (sanitized.faq_schema as any[]).length) {
              sanitized.faq_schema = inRange.slice(0, 5);
            }
          }
        }
        /* Cut B safety net: internal_links anchors must be approved variations.
         * Repair paraphrased anchors (swap in the first approved variation for
         * that URL, matched on a normalized URL key). Never drop an entry whose
         * URL we can't find in our (possibly filtered) candidate list — the
         * validator checks the full link_targets table. De-dupe repeated URLs
         * only when ≥3 entries survive. */
        if (Array.isArray(sanitized.internal_links) && stitchLinkTargets.length > 0) {
          const normUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
          const targetByUrl = new Map(stitchLinkTargets.map((t) => [normUrl(t.url), t]));
          const repaired = (sanitized.internal_links as any[]).map((l: any) => {
            const target = targetByUrl.get(normUrl(String(l?.target_url || "")));
            if (!target || target.anchors.length === 0) return l;
            const anchor = String(l?.anchor_text || "").trim().toLowerCase();
            const ok = target.anchors.some((a) => a.trim().toLowerCase() === anchor);
            if (!ok) {
              req.log.info({ url: l?.target_url, from: l?.anchor_text, to: target.anchors[0] }, "final-stitch: internal_links net repaired anchor");
              return { ...l, anchor_text: target.anchors[0] };
            }
            return l;
          });
          const seenUrls = new Set<string>();
          const deduped = repaired.filter((l: any) => {
            const key = normUrl(String(l?.target_url || ""));
            if (seenUrls.has(key)) return false;
            seenUrls.add(key);
            return true;
          });
          sanitized.internal_links = (deduped.length >= 3 ? deduped : repaired).slice(0, 5);
        }
        /* Cut B safety net: statistics_used entries whose source_url is a
         * bare domain (no path) are guaranteed to be stripped by the live
         * verifier and one strip blocks ship — remove them up front. An
         * empty statistics_used list passes. */
        if (Array.isArray(sanitized.statistics_used)) {
          const before = (sanitized.statistics_used as any[]).length;
          sanitized.statistics_used = (sanitized.statistics_used as any[]).filter((s: any) => {
            const raw = String(s?.source_url || "").trim();
            if (!raw) return false;
            try {
              const u = new URL(raw);
              return u.pathname.replace(/\/+$/, "").length > 1;
            } catch {
              return false;
            }
          });
          const after = (sanitized.statistics_used as any[]).length;
          if (after !== before) {
            req.log.info({ before, after }, "final-stitch: statistics net dropped bare-domain sources");
          }
        }
        /* Cut B safety net: opening_block.first_100_words is defined as the
         * verbatim first 100 words of the body after the H1 — compute it
         * deterministically instead of trusting the extraction model. */
        try {
          const first100 = stitched
            .replace(/^#\s.*$/m, "")
            .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^[-*+]\s+/gm, "")
            .replace(/^\d+\.\s+/gm, "")
            .replace(/[*_`>|]/g, "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 100)
            .join(" ");
          if (first100) {
            sanitized.opening_block = { ...(sanitized.opening_block || {}), first_100_words: first100 };
          }
        } catch (e) {
          req.log.warn({ err: e }, "final-stitch: opening-block net failed (non-fatal)");
        }
        /* Cut B safety net: meta_description must be 150–155 chars and carry
         * the keyword — repair out-of-range extractions with one bounded
         * micro-call, falling back to the outline's meta if it qualifies. */
        try {
          const kwLc = primaryKeyword.trim().toLowerCase();
          const metaOk = (m: string) => {
            const t = m.trim();
            return t.length >= 150 && t.length <= 155 && (!kwLc || t.toLowerCase().includes(kwLc));
          };
          if (!metaOk(String(sanitized.meta_description || ""))) {
            const outlineMeta = String((outline as any).metaDescription || "").trim();
            if (metaOk(outlineMeta)) {
              sanitized.meta_description = outlineMeta;
              req.log.info({ len: outlineMeta.length }, "final-stitch: meta net used outline meta description");
            } else {
              for (let attempt = 1; attempt <= 2; attempt++) {
                const tMeta = Date.now();
                const metaUserId = buildAnthropicUserId({ pod: (project as any).pod, stage: "final-stitch", substage: `meta-fix-${attempt}`, writer_id: (project as any).writerId });
                const metaData = await callAnthropicRaw({
                  model: SONNET,
                  max_tokens: 300,
                  metadata: { user_id: metaUserId },
                  system: `Revise the given meta description so it is BETWEEN 150 AND 155 characters (count every character including spaces and punctuation; aim for 152–153) and contains the phrase "${primaryKeyword}" verbatim. Keep the meaning. Return ONLY the revised meta description text with no quotes or commentary.`,
                  messages: [{ role: "user", content: String(sanitized.meta_description || outlineMeta || "") }],
                });
                await logUsage({ project_id, brand_id: project.brandId, stage: "final-stitch", sub_stage: `meta-fix-${attempt}`, model: SONNET, metadata_user_id: metaUserId, usage: metaData.usage, duration_ms: Date.now() - tMeta, ok: true });
                const fixed = (metaData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim().replace(/^["']|["']$/g, "");
                if (metaOk(fixed)) {
                  sanitized.meta_description = fixed;
                  req.log.info({ attempt, len: fixed.length }, "final-stitch: meta net repaired meta description");
                  break;
                }
                req.log.warn({ attempt, len: fixed.length }, "final-stitch: meta net attempt out of range");
              }
            }
          }
        } catch (e) {
          req.log.warn({ err: e }, "final-stitch: meta net failed (non-fatal)");
        }
        sanitized.lsi_retrieved = lsiRetrieved;
        sanitized.lsi_used_in_body = lsiCov.used;
        sanitized.lsi_coverage_ratio = lsiCov.ratio;

        const deps = buildValidatorDeps(project.brandId, project.playbookVersion);
      const result = await mod.convertToMarkdown({ buffer: bytes });
        // Persist the validator-sanitized copy (HARD-stripped items removed,
        // verified_live / flagged_as_stale flags applied) — never the raw extract.
        articleSchema = result.sanitizedArticle;
        validation = result;

        /* Provenance: one row per validator strip (reason 'validator-stripped'). */
        const provRows = result.checks.flatMap((c: any) =>
          (c.stripped || []).map((item: any) => ({
            brandId: project.brandId,
            entityType: "draft_score",
            entityId: project_id,
            sourceModule: "content-forge",
            generationMethod: "validator-stripped",
            metadata: { check: c.key, reason: c.reason, severity: c.severity, item },
          })),
        );
        if (provRows.length > 0) {
          try {
            await db.insert(moduleDataProvenanceTable).values(provRows);
          } catch (e) {
            req.log.warn({ err: e }, "final-stitch: provenance insert failed (non-fatal)");
          }
        }
      } else {
        extraction_failed = true;
      }
    } catch (e) {
      extraction_failed = true;
      req.log.error({ err: e }, "final-stitch: article-schema extraction failed");
    }
    if (extraction_failed && !validation) {
      validation = { shippable: false, extraction_failed: true, checks: [] };
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
        articleSchema: articleSchema as any,
        validation,
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
          articleSchema: articleSchema as any,
          validation,
          updatedAt: new Date(),
        },
      });

    await db
      .update(projectsTable)
      .set({
        currentStage: 4,
        status: "review",
        lsiUsed: lsiCov.used as any,
        lsiCoverageRatio: String(lsiCov.ratio),
      })
      .where(and(eq(projectsTable.id, project_id), eq(projectsTable.brandId, brandId)));

    res.json({ ok: true, word_count, voice_match_score, originality_score, banned_phrase_count, citation_completeness, ai_citation_readiness_score, atomic_chunks_count, atomic_questions_count, schema_markup_recommendations, validation, lsi_coverage_ratio: lsiCov.ratio });
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
    const { brandId, filename, mime_type, content_base64, uploaded_by } = req.body as {
      brandId?: string; filename?: string; mime_type?: string; content_base64?: string; uploaded_by?: string;
    };
    if (!brandId) { res.status(400).json({ error: "brandId is required" }); return; }
    const brand = await db.select({ id: brandsTable.id }).from(brandsTable).where(eq(brandsTable.id, brandId)).limit(1);
    if (!brand.length) { res.status(404).json({ error: "brand not found" }); return; }
    if (!filename || !content_base64) { res.status(400).json({ error: "filename and content_base64 are required" }); return; }

    const bytes = Buffer.from(content_base64, "base64");
    const lower = filename.toLowerCase();

    const markdown = latest.contentMarkdown || "";
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

    const { playbookRow, sections } = await createPlaybookVersion({
      brandId,
      markdown,
      sourceFilename: filename,
      uploadedBy: uploaded_by || null,
    });
    if (sections.length === 0) {
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
    const { brandId } = req.body as { brandId?: string };
    if (!brandId) { res.status(400).json({ error: "brandId is required" }); return; }
    const brand = await db.select({ id: brandsTable.id }).from(brandsTable).where(eq(brandsTable.id, brandId)).limit(1);
    if (!brand.length) { res.status(404).json({ error: "brand not found" }); return; }
    const latestRows = await db
      .select({ version: playbookTable.version, contentMarkdown: playbookTable.contentMarkdown })
      .from(playbookTable)
      .where(eq(playbookTable.brandId, brandId))
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

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`playbook:${brandId}`}))`);
      await tx.delete(playbookSectionsTable).where(and(eq(playbookSectionsTable.brandId, brandId), eq(playbookSectionsTable.version, version)));
      await tx.insert(playbookSectionsTable).values(sections.map((s) => ({
        version,
        brandId,
        sectionNumber: s.section_number,
        sectionTitle: s.section_title,
        sectionContent: s.section_content,
        sectionTokenEstimate: s.section_token_estimate,
        alwaysInclude: ALWAYS_INCLUDE.includes(s.section_number) || s.always_include,
      })));
    });

    res.json({ ok: true, version, sections_count: sections.length, sections: sections.map((s) => ({ n: s.section_number, title: s.section_title, tokens: s.section_token_estimate })) });
  } catch (e) {
    req.log.error({ err: e }, "playbook-reparse route error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
