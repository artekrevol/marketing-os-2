import { db, fetchedPagesTable, researchBriefsTable, proofPointsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { buildRoutedSystem } from "./playbook.js";
import { logUsage } from "./usage.js";
import { buildAnthropicUserId } from "./anthropic-meta.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-5-20250929";

/* ───────── URL fetch + cache (1h TTL) ───────── */

const ONE_HOUR_MS = 60 * 60 * 1000;

function stripHtml(html: string): { title: string; text: string } {
  let title = "";
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (m) title = m[1]!.trim();
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > 18000) cleaned = cleaned.slice(0, 18000) + "…[truncated]";
  return { title, text: cleaned };
}

export type PageFetchResult = {
  url: string;
  title: string;
  text: string;
  ok: boolean;
  bytes: number;
  httpStatus?: number;
  error?: string;
  fromCache?: boolean;
};

/**
 * Fetch a URL (with 1h cache) and return parsed text + status metadata.
 * Always returns a PageFetchResult — `ok: false` indicates the fetch
 * failed, but the caller still gets the status so it can be surfaced
 * to the user. A cache-write failure is logged but never throws away
 * good fetched content.
 */
export async function getCachedPage(url: string, brandId?: string | null): Promise<PageFetchResult> {
  if (!url) return { url: "", title: "", text: "", ok: false, bytes: 0, error: "no url" };

  // 1) Cache hit
  try {
    const cachedRows = await db
      .select({ title: fetchedPagesTable.title, content: fetchedPagesTable.content, fetchedAt: fetchedPagesTable.fetchedAt })
      .from(fetchedPagesTable)
      .where(eq(fetchedPagesTable.url, url))
      .limit(1);
    const cached = cachedRows[0];
    // Only treat the cache row as a hit if it actually has content — an
    // empty/null content row (e.g. left over from a prior bug) should
    // force a fresh fetch rather than serve nothing for an hour.
    if (cached?.fetchedAt && cached.content && Date.now() - new Date(cached.fetchedAt).getTime() < ONE_HOUR_MS) {
      const text = cached.content;
      return { url, title: cached.title || "", text, ok: true, bytes: text.length, fromCache: true };
    }
  } catch (e) {
    console.warn(`[cache] read error for ${url}: ${e}`);
  }

  // 2) Live fetch
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  let html = "";
  let httpStatus: number | undefined;
  let fetchError: string | undefined;
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        // Real-browser UA: many sites (e.g. Cloudflare-fronted, WordPress
        // hardened with Wordfence) return 403/blank to obvious bot UAs.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    httpStatus = r.status;
    if (r.ok) html = await r.text();
    else fetchError = `HTTP ${r.status}`;
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
    console.warn(`[fetch] failed ${url}: ${fetchError}`);
  } finally {
    clearTimeout(t);
  }

  if (!html) {
    return { url, title: "", text: "", ok: false, bytes: 0, httpStatus, error: fetchError || "empty response" };
  }

  const parsed = stripHtml(html);

  // 3) Cache write — best-effort. If this fails (e.g. tenant trigger
  // requiring brand_id), we still return the fetched content so the
  // research stages get real context.
  try {
    await db
      .insert(fetchedPagesTable)
      .values({
        url,
        title: parsed.title,
        content: parsed.text,
        byteSize: parsed.text.length,
        fetchedAt: new Date(),
        ...(brandId ? { brandId } : {}),
      })
      .onConflictDoUpdate({
        target: fetchedPagesTable.url,
        set: {
          title: parsed.title,
          content: parsed.text,
          byteSize: parsed.text.length,
          fetchedAt: new Date(),
          ...(brandId ? { brandId } : {}),
        },
      });
  } catch (e) {
    console.warn(`[cache] write error for ${url}: ${e}`);
  }

  return { url, title: parsed.title, text: parsed.text, ok: true, bytes: parsed.text.length, httpStatus };
}

/* ───────── Anthropic call wrapper ───────── */

async function callAnthropic(args: {
  model: string;
  systemBlocks: any[];
  userText: string;
  tool: any;
  webSearchMaxUses?: number;
  timeoutMs: number;
  maxTokens?: number;
  metadataUserId?: string;
}): Promise<{ input: any; usage: any }> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const tools: any[] = [args.tool];
  if (args.webSearchMaxUses && args.webSearchMaxUses > 0) {
    tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: args.webSearchMaxUses });
  }
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(args.webSearchMaxUses && args.webSearchMaxUses > 0
          ? { "anthropic-beta": "web-search-2025-03-05" }
          : {}),
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxTokens ?? 4000,
        ...(args.metadataUserId ? { metadata: { user_id: args.metadataUserId } } : {}),
        system: args.systemBlocks,
        tools,
        tool_choice: { type: "tool", name: args.tool.name },
        messages: [{ role: "user", content: args.userText }],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${txt.slice(0, 400)}`);
    }
    const data = await resp.json() as any;
    const tu = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === args.tool.name);
    if (!tu) {
      const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      throw new Error(`No tool_use returned. Raw: ${text.slice(0, 300)}`);
    }
    return { input: tu.input, usage: data.usage || {} };
  } finally {
    clearTimeout(to);
  }
}

/* ───────── Per-stage tool schemas ───────── */

const TOOLS = {
  search_intent: {
    name: "submit_search_intent",
    description: "Return search intent + keyword cluster facts.",
    input_schema: {
      type: "object",
      properties: {
        reader_goal: { type: "string" },
        awareness_stage: { type: "string" },
        required_belief: { type: "string" },
        notes: { type: "string" },
      },
      required: ["reader_goal", "awareness_stage", "required_belief"],
    },
  },
  benchmark_teardown: {
    name: "submit_benchmark_teardown",
    description: "Teardown of benchmark blog.",
    input_schema: {
      type: "object",
      properties: {
        opening_hook: { type: "string" },
        voice_signature: { type: "string" },
        structural_moves: { type: "array", items: { type: "string" } },
        proof_techniques: { type: "array", items: { type: "string" } },
        three_things_to_steal: { type: "array", items: { type: "string" } },
        two_things_to_skip: { type: "array", items: { type: "string" } },
        cited_passages: { type: "array", items: { type: "string" } },
      },
      required: ["opening_hook", "voice_signature"],
    },
  },
  competitor_teardown: {
    name: "submit_competitor_teardown",
    description: "Teardown of competitor service page.",
    input_schema: {
      type: "object",
      properties: {
        hero_claim: { type: "string" },
        trust_signals: { type: "array", items: { type: "string" } },
        architecture: { type: "array", items: { type: "string" } },
        pricing_transparency: { type: "string" },
        cta_strategy: { type: "string" },
        seo_moves: { type: "array", items: { type: "string" } },
        what_they_do_well: { type: "array", items: { type: "string" } },
        whats_exploitable: { type: "array", items: { type: "string" } },
      },
      required: ["hero_claim"],
    },
  },
  synergy_map: {
    name: "submit_synergy_map",
    description: "Synergy map vs company domain.",
    input_schema: {
      type: "object",
      properties: {
        existing_assets: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, url: { type: "string" }, why: { type: "string" } },
            required: ["title"],
          },
        },
        proprietary_data_points: { type: "array", items: { type: "string" } },
        leadership_pov: { type: "array", items: { type: "string" } },
        voice_patterns: { type: "array", items: { type: "string" } },
        ownable_angle: { type: "string" },
      },
      required: ["ownable_angle"],
    },
  },
  angle_and_conversion: {
    name: "submit_angle_and_conversion",
    description: "Angle inventory + conversion signal map + proof points.",
    input_schema: {
      type: "object",
      properties: {
        angle_inventory: {
          type: "object",
          properties: {
            overdone: { type: "array", items: { type: "string" } },
            open_territory: { type: "array", items: { type: "string" } },
            avoid_entirely: { type: "array", items: { type: "string" } },
          },
          required: ["overdone", "open_territory"],
        },
        conversion_signals: {
          type: "object",
          properties: {
            act_triggers: { type: "string" },
            required_belief: { type: "string" },
            mid_cta: { type: "string" },
            closing_cta: { type: "string" },
            discard_list: { type: "array", items: { type: "string" } },
          },
        },
        proof_points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string" },
              source_url: { type: "string" },
              source_publication: { type: "string" },
              publication_date: { type: "string" },
              verification_status: { type: "string", enum: ["verified", "unverified", "needs writer confirmation"] },
            },
            required: ["claim", "verification_status"],
          },
        },
      },
      required: ["angle_inventory", "conversion_signals", "proof_points"],
    },
  },
  ai_citation_landscape: {
    name: "submit_ai_citation_landscape",
    description: "How this topic surfaces in AI search.",
    input_schema: {
      type: "object",
      properties: {
        sample_buyer_prompts: { type: "array", items: { type: "string" } },
        top_cited_sources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              publisher: { type: "string" },
              kind: { type: "string", enum: ["competitor", "aggregator", "authority", "owned_media", "other"] },
              why_cited: { type: "string" },
            },
            required: ["url", "publisher", "kind", "why_cited"],
          },
        },
        citation_gaps: { type: "array", items: { type: "string" } },
        suggested_authority_sources: {
          type: "array",
          items: {
            type: "object",
            properties: { publisher: { type: "string" }, url_or_topic: { type: "string" }, why: { type: "string" } },
            required: ["publisher", "why"],
          },
        },
      },
      required: ["sample_buyer_prompts", "citation_gaps"],
    },
  },
  atomic_and_entities: {
    name: "submit_atomic_and_entities",
    description: "Atomic question map + entity/data density requirements.",
    input_schema: {
      type: "object",
      properties: {
        atomic_question_map: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              liftable_paragraph: { type: "boolean" },
              suggested_location: { type: "string" },
              requires_citation: { type: "boolean" },
            },
            required: ["question", "liftable_paragraph", "suggested_location", "requires_citation"],
          },
        },
        entity_data_requirements: {
          type: "object",
          properties: {
            minimum_named_entities: {
              type: "object",
              properties: {
                clients: { type: "number" },
                dollar_amounts: { type: "number" },
                dates: { type: "number" },
                locations: { type: "number" },
                named_processes: { type: "number" },
                named_people: { type: "number" },
              },
            },
            required_authority_citations: { type: "number" },
            recommended_schema_types: {
              type: "array",
              items: {
                type: "string",
                enum: ["FAQPage", "HowTo", "Article", "BlogPosting", "LocalBusiness", "Organization", "Product", "Review"],
              },
            },
            originality_threshold: { type: "number" },
          },
        },
      },
      required: ["atomic_question_map", "entity_data_requirements"],
    },
  },
} as const;

/* ───────── Stage runners ───────── */

export type StageKey =
  | "search_intent"
  | "benchmark_teardown"
  | "competitor_teardown"
  | "synergy_map"
  | "angle_and_conversion"
  | "ai_citation_landscape"
  | "atomic_and_entities";

export const STAGE_KEYS: StageKey[] = [
  "search_intent",
  "benchmark_teardown",
  "competitor_teardown",
  "synergy_map",
  "angle_and_conversion",
  "ai_citation_landscape",
  "atomic_and_entities",
];

export const STAGE_LABELS: Record<StageKey, string> = {
  search_intent: "Search intent + keyword cluster",
  benchmark_teardown: "Benchmark blog teardown",
  competitor_teardown: "Competitor page teardown",
  synergy_map: "Company synergy map",
  angle_and_conversion: "Angle inventory + proof points",
  ai_citation_landscape: "AI citation landscape",
  atomic_and_entities: "Atomic questions + entity density",
};

const STAGE_MODEL: Record<StageKey, string> = {
  search_intent: HAIKU,
  atomic_and_entities: HAIKU,
  benchmark_teardown: HAIKU,
  competitor_teardown: HAIKU,
  // synergy_map: moved Sonnet → Haiku. The task is summarising the
  // pre-fetched company homepage, not deep reasoning. Cuts ~49s → ~10s
  // on the critical path with negligible quality loss.
  synergy_map: HAIKU,
  ai_citation_landscape: SONNET,
  angle_and_conversion: SONNET,
};

const STAGE_TIMEOUT_MS: Record<StageKey, number> = {
  search_intent: 30_000,
  atomic_and_entities: 30_000,
  benchmark_teardown: 60_000,
  competitor_teardown: 60_000,
  synergy_map: 60_000,
  ai_citation_landscape: 60_000,
  angle_and_conversion: 60_000,
};

const STAGE_WEB_SEARCH: Record<StageKey, number> = {
  search_intent: 3,
  benchmark_teardown: 0,
  competitor_teardown: 0,
  synergy_map: 0,
  ai_citation_landscape: 3,
  angle_and_conversion: 3,
  atomic_and_entities: 0,
};

function projectContext(project: any): string {
  return `Project context:
- Topic: ${project.topic}
- Content type: ${project.content_type}
- Target ICPs: ${(project.icps || []).join(", ") || "(none)"}
- Funnel stage: ${project.funnel_stage || "(unspecified)"}
- Primary keyword: ${project.keyword || "(none)"}
- Benchmark URL: ${project.benchmark_url || "(none)"}
- Competitor URL: ${project.competitor_url || "(none)"}
- Company domain: ${project.company_domain}
- User notes: ${project.user_notes || "(none)"}`;
}

const COMMON_SEARCH_RULE =
  "HARD LIMIT: 3 web_search calls maximum. After 3 searches you MUST stop searching and call the submission tool with whatever you have. Prefer one authoritative source over multiple searches for the same fact.";

function pageBlock(label: string, page: PageFetchResult | null): string {
  if (!page || !page.text) {
    const reason = page?.error ? ` (${page.error})` : "";
    return `${label}: (could not fetch${reason} — work from URL alone)`;
  }
  return `${label} (pre-fetched, title="${page.title}"):\n${page.text}`;
}

function buildStageInstructions(
  stage: StageKey,
  project: any,
  pages: {
    benchmark: PageFetchResult | null;
    competitor: PageFetchResult | null;
    company: PageFetchResult | null;
  },
): string {
  const ctx = projectContext(project);
  switch (stage) {
    case "search_intent":
      return `${ctx}\n\nDetermine the SEARCH INTENT for this piece. Identify the reader_goal (what the searcher is trying to do), awareness_stage (problem-aware / solution-aware / vendor-aware), and required_belief (what they must believe by the end). Be concrete and specific to this keyword and ICP. ${COMMON_SEARCH_RULE} Call submit_search_intent.`;

    case "benchmark_teardown":
      return `${ctx}\n\n${pageBlock("BENCHMARK PAGE CONTENT", pages.benchmark)}\n\nTear down the benchmark blog above. Identify opening_hook, voice_signature, structural_moves, proof_techniques, 3 things_to_steal, 2 things_to_skip, and notable cited_passages. Work primarily from the pre-fetched content; only web_search if it is missing. Call submit_benchmark_teardown.`;

    case "competitor_teardown":
      return `${ctx}\n\n${pageBlock("COMPETITOR PAGE CONTENT", pages.competitor)}\n\nTear down the competitor service/landing page above. Identify hero_claim, trust_signals, architecture (page sections in order), pricing_transparency, cta_strategy, seo_moves, what_they_do_well, and what's exploitable for ${project.company_domain}. Work primarily from the pre-fetched content. Call submit_competitor_teardown.`;

    case "synergy_map":
      return `${ctx}\n\n${pageBlock("COMPANY HOMEPAGE CONTENT", pages.company)}\n\nBuild a synergy map for ${project.company_domain}. Identify existing_assets (real URLs on this domain that the new piece can link to), proprietary_data_points the company can mention, leadership_pov themes, voice_patterns, and the ownable_angle this article should claim. ${COMMON_SEARCH_RULE} Call submit_synergy_map.`;

    case "angle_and_conversion":
      return `${ctx}\n\nProduce angle_inventory (overdone / open_territory / avoid_entirely angles for this topic), conversion_signals (act_triggers, required_belief, mid_cta, closing_cta, discard_list of clichés to avoid), and 6-12 proof_points with source_url, publication, publication_date, and verification_status. Never fabricate sources — mark unverifiable claims as 'needs writer confirmation'. Authority publishers preferred: Statista, Pew, Gartner, Forrester, McKinsey, BLS, Census, peer-reviewed, named industry sources. Avoid Wikipedia and AI-generated content. ${COMMON_SEARCH_RULE} Call submit_angle_and_conversion.`;

    case "ai_citation_landscape":
      return `${ctx}\n\nMap the AI citation landscape for this topic. Run web searches that mimic real buyer prompts an ICP would type into ChatGPT/Claude/Perplexity/Gemini (e.g. "best X for Y", "X vs Y", "how much does X cost"). Identify sample_buyer_prompts (4-8), top_cited_sources currently surfaced (each MUST include the exact url you saw in the search results — never invent or guess URLs; if you cannot cite a real URL for a source, omit that source entirely), citation_gaps where ${project.company_domain} can insert proprietary data, and suggested_authority_sources (for these, url_or_topic may be a topic string like "Statista report on X" if no canonical URL exists). ${COMMON_SEARCH_RULE} Call submit_ai_citation_landscape.`;

    case "atomic_and_entities":
      return `${ctx}\n\nProduce two things: (1) atomic_question_map of 8-15 atomic, liftable buyer questions this article must answer as standalone citation-ready paragraphs, each with suggested_location and requires_citation flag; (2) entity_data_requirements specifying minimum_named_entities (clients, dollar_amounts, dates, locations, named_processes, named_people), required_authority_citations, recommended_schema_types (JSON-LD), and originality_threshold (proprietary data points absent from top-10 SERP). Call submit_atomic_and_entities.`;
  }
}

/**
 * Atomic per-key patch of research_briefs.sub_status JSONB using jsonb_set
 * in a single UPDATE. The previous read-modify-write version suffered from
 * lost updates when multiple of the 7 parallel stages mutated sub_status
 * concurrently (a stage could finish, write "done", then a stale snapshot
 * from another stage would overwrite it back to "running"). Postgres takes
 * a row lock during UPDATE, so chained jsonb_set calls here serialize
 * correctly across concurrent callers.
 */
async function mergeSubStatus(project_id: string, patch: Record<string, any>): Promise<void> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return;

  let expr = sql`coalesce(${researchBriefsTable.subStatus}, '{}'::jsonb)`;
  for (const [key, value] of entries) {
    const path = `{${key}}`;
    const jsonVal = JSON.stringify(value);
    expr = sql`jsonb_set(${expr}, ${path}::text[], ${jsonVal}::jsonb, true)`;
  }

  await db
    .update(researchBriefsTable)
    .set({ subStatus: expr })
    .where(eq(researchBriefsTable.projectId, project_id));
}

export async function runStage(args: {
  project: any;
  stage: StageKey;
  pages: {
    benchmark: PageFetchResult | null;
    competitor: PageFetchResult | null;
    company: PageFetchResult | null;
  };
}): Promise<{ ok: boolean; output?: any; error?: string }> {
  const { project, stage, pages } = args;

  await mergeSubStatus(project.id, { [stage]: { status: "running", error: null, updated_at: new Date().toISOString() } });

  const instructions = buildStageInstructions(stage, project, pages);
  const { system: systemBlocks, included } = await buildRoutedSystem(stage, instructions);
  console.log(`[stage:${stage}] routed playbook sections: [${included.join(",")}]`);

  const metadataUserId = buildAnthropicUserId({
    pod: project.pod,
    stage: "stage1",
    substage: stage,
    writer_id: project.writer_id,
  });

  try {
    const t0 = Date.now();
    const { input: output, usage } = await callAnthropic({
      model: STAGE_MODEL[stage],
      systemBlocks,
      userText: `Run the ${stage.replace(/_/g, " ")} task and call the tool.`,
      tool: TOOLS[stage],
      webSearchMaxUses: STAGE_WEB_SEARCH[stage],
      timeoutMs: STAGE_TIMEOUT_MS[stage],
      maxTokens: 4000,
      metadataUserId,
    });

    await logUsage({
      project_id: project.id,
      stage: "research",
      sub_stage: stage,
      model: STAGE_MODEL[stage],
      metadata_user_id: metadataUserId,
      usage,
      duration_ms: Date.now() - t0,
      ok: true,
    });

    const patch: any = {};
    if (stage === "search_intent") patch.searchIntent = output;
    else if (stage === "benchmark_teardown") patch.benchmarkTeardown = output;
    else if (stage === "competitor_teardown") patch.competitorTeardown = output;
    else if (stage === "synergy_map") patch.synergyMap = output;
    else if (stage === "ai_citation_landscape") patch.aiCitationLandscape = output;
    else if (stage === "atomic_and_entities") {
      patch.atomicQuestionMap = output.atomic_question_map || [];
      patch.entityDataRequirements = output.entity_data_requirements || {};
    } else if (stage === "angle_and_conversion") {
      patch.angleInventory = output.angle_inventory || {};
      patch.conversionSignals = output.conversion_signals || {};
      const ppRows = (output.proof_points || []).map((p: any) => ({
        projectId: project.id,
        brandId: project.brand_id,
        claim: p.claim,
        sourceUrl: p.source_url || null,
        sourcePublication: p.source_publication || null,
        publicationDate: p.publication_date || null,
        verificationStatus: p.verification_status || "unverified",
      }));
      await db.delete(proofPointsTable).where(eq(proofPointsTable.projectId, project.id));
      if (ppRows.length) await db.insert(proofPointsTable).values(ppRows);
      patch.proofPointsStatus = "done";
    }

    await db.update(researchBriefsTable).set(patch).where(eq(researchBriefsTable.projectId, project.id));
    await mergeSubStatus(project.id, { [stage]: { status: "done", error: null, updated_at: new Date().toISOString() } });
    return { ok: true, output };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[stage:${stage}] error: ${msg}`);
    await logUsage({
      project_id: project.id,
      stage: "research",
      sub_stage: stage,
      model: STAGE_MODEL[stage],
      metadata_user_id: metadataUserId,
      ok: false,
      error: msg.slice(0, 300),
    });
    await mergeSubStatus(project.id, { [stage]: { status: "error", error: msg.slice(0, 300), updated_at: new Date().toISOString() } });
    if (stage === "angle_and_conversion") {
      await db.update(researchBriefsTable).set({ proofPointsStatus: "error" }).where(eq(researchBriefsTable.projectId, project.id));
    }
    return { ok: false, error: msg };
  }
}

export type PrefetchSummary = {
  benchmark: PageFetchResult | null;
  competitor: PageFetchResult | null;
  company: PageFetchResult | null;
};

export async function prefetchPages(project: any): Promise<PrefetchSummary> {
  const brandId: string | null = project.brand_id ?? project.brandId ?? null;
  const companyUrl = project.company_domain
    ? project.company_domain.startsWith("http")
      ? project.company_domain
      : `https://${project.company_domain}`
    : "";
  const [benchmark, competitor, company] = await Promise.all([
    project.benchmark_url ? getCachedPage(project.benchmark_url, brandId) : Promise.resolve(null),
    project.competitor_url ? getCachedPage(project.competitor_url, brandId) : Promise.resolve(null),
    companyUrl ? getCachedPage(companyUrl, brandId) : Promise.resolve(null),
  ]);
  return { benchmark, competitor, company };
}

/**
 * Persist a per-URL summary of what prefetchPages returned into
 * `research_briefs.sub_status._prefetch` so the UI can show the user
 * exactly which pages were fed to the model (vs hallucinated from URL).
 */
export async function recordPrefetchStatus(projectId: string, pages: PrefetchSummary): Promise<void> {
  const slim = (p: PageFetchResult | null) =>
    p
      ? {
          url: p.url,
          ok: p.ok,
          bytes: p.bytes,
          title: p.title || null,
          http_status: p.httpStatus ?? null,
          error: p.error ?? null,
          from_cache: p.fromCache ?? false,
        }
      : null;
  await mergeSubStatus(projectId, {
    _prefetch: {
      benchmark: slim(pages.benchmark),
      competitor: slim(pages.competitor),
      company: slim(pages.company),
      recorded_at: new Date().toISOString(),
    },
  });
}
