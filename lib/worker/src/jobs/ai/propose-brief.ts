import type { JobData } from "@workspace/jobs";
import {
  buildRoutedSystem,
  logUsage,
  buildAnthropicUserId,
} from "@workspace/content-ai";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5-20250929";
const TOPIC_MAX = 200;

const PROPOSE_TOOL = {
  name: "submit_brief_proposal",
  description: "Submit the structured Step-2 brief proposal.",
  input_schema: {
    type: "object",
    properties: {
      keyword_cluster: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            estimated_monthly_volume: { type: "number" },
            volume_is_estimated: { type: "boolean" },
            competition: { type: "string", enum: ["low", "medium", "high"] },
            is_primary: { type: "boolean" },
            reasoning: { type: "string" },
          },
          required: ["keyword", "competition", "is_primary"],
        },
      },
      primary_keyword_reasoning: { type: "string" },
      funnel_stage: { type: "string", enum: ["TOFU", "MOFU", "BOFU"] },
      funnel_reasoning: { type: "string" },
      icps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            label: { type: "string" },
            playbook_citation: { type: "string" },
          },
          required: ["id", "label", "playbook_citation"],
        },
      },
      pod: { type: "string" },
      pod_reasoning: { type: "string" },
      benchmark_candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            publisher: { type: "string" },
            why: { type: "string" },
            rank: { type: "number" },
          },
          required: ["url", "publisher", "why", "rank"],
        },
      },
      competitor_candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            publisher: { type: "string" },
            serp_position: { type: "number" },
            why: { type: "string" },
            rank: { type: "number" },
          },
          required: ["url", "why", "rank"],
        },
      },
      content_type: {
        type: "string",
        enum: [
          "cost_guide",
          "comparison_guide",
          "how_to_guide",
          "statistics_trends",
          "explainer",
          "case_study",
          "vertical_deep_dive",
          "thought_leadership",
        ],
      },
      mode: { type: "string", enum: ["composition", "interview"] },
      mode_reasoning: { type: "string" },
      ai_citation_landscape: {
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
              properties: {
                publisher: { type: "string" },
                url_or_topic: { type: "string" },
                why: { type: "string" },
              },
              required: ["publisher", "why"],
            },
          },
        },
        required: ["sample_buyer_prompts", "top_cited_sources", "citation_gaps", "suggested_authority_sources"],
      },
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
            items: { type: "string", enum: ["FAQPage", "HowTo", "Article", "BlogPosting", "LocalBusiness", "Organization", "Product", "Review"] },
          },
          originality_threshold: { type: "number" },
        },
        required: ["minimum_named_entities", "required_authority_citations", "recommended_schema_types", "originality_threshold"],
      },
    },
    required: [
      "keyword_cluster",
      "funnel_stage",
      "icps",
      "pod",
      "benchmark_candidates",
      "competitor_candidates",
      "content_type",
      "mode",
      "ai_citation_landscape",
      "atomic_question_map",
      "entity_data_requirements",
    ],
  },
};

export async function handleAiProposeBrief(
  data: JobData<"ai.propose-brief">,
  log: Logger,
): Promise<void> {
  const { project_id, brandId, playbookVersion } = data;
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const projectRows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, project_id))
    .limit(1);
  const project = projectRows[0];
  if (!project) throw new Error(`project not found: ${project_id}`);
  if (project.brandId !== brandId) {
    throw new Error(`brand mismatch for project ${project_id}`);
  }

  const topicTrimmed = String(project.topic || "").trim();
  if (topicTrimmed.length === 0) {
    await db.update(projectsTable).set({ status: "brief_failed", briefError: "Project topic is empty." }).where(eq(projectsTable.id, project_id));
    throw new Error("Project topic is empty.");
  }
  if (topicTrimmed.length > TOPIC_MAX) {
    const errMsg = `Project topic exceeds ${TOPIC_MAX} characters (got ${topicTrimmed.length}).`;
    await db.update(projectsTable).set({ status: "brief_failed", briefError: errMsg }).where(eq(projectsTable.id, project_id));
    throw new Error(errMsg);
  }

  const stageInstructions = `You are the intake research assistant for ${project.companyDomain}'s content pipeline. Read the company playbook above fully before responding.

Topic the user wants to write about: ${project.topic}
User notes: ${project.userNotes || "(none)"}

Use web search to:
1. Identify the keyword cluster around this topic — 5-10 related keywords with estimated monthly search volume and competition level. Suggest one primary keyword (set is_primary=true) based on intent match and ranking opportunity.
2. Determine search intent and funnel stage (TOFU / MOFU / BOFU).
3. Match 1-4 ICPs from the playbook based on topic and keyword intent. Cite the exact playbook section or quote that justifies each match.
4. Recommend the best pod from the playbook based on topic alignment with pod specialties.
5. Find 3 high-quality benchmark blogs (editorial standards to emulate — Neil Patel, Backlinko, a16z, First Round Review, or specialist publishers in the topic's vertical) for this topic. Rank them 1-3.
6. Find the top 3 ranking competitor pages for the proposed primary keyword via live SERP. Include serp_position. Rank them 1-3 by current position.
7. Choose the most appropriate content_type from: cost_guide, comparison_guide, how_to_guide, statistics_trends, explainer, case_study, vertical_deep_dive, thought_leadership. Default to "explainer" and mode=composition unless a more specific type clearly fits (e.g. "how_to_guide" for instructional topics, "comparison_guide" for head-to-head topics, "cost_guide" for pricing topics, "thought_leadership" for founder/opinion pieces).

Every proposal must include one-line reasoning. Cite playbook sections by name or quote, and cite web sources by URL. Never fabricate search volumes — if exact data isn't available, set volume_is_estimated=true and explain the basis in the reasoning field.

Also run web searches to map the AI citation landscape for this topic. Identify how it currently surfaces across ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews:
- Where the company's domain is already cited (or absent)
- Which competitor domains appear most often
- Which authority sources (Statista, Pew, Gartner, BLS, peer-reviewed, etc.) dominate the topic
- Where ${project.companyDomain} could insert itself with proprietary data, named clients, or original analysis

Then map the atomic questions this article must answer in liftable, citation-ready chunks. Atomic = a single paragraph that completely answers one question and reads correctly out of context. Aim for 8-15 atomic questions.

Then specify entity and data density requirements: minimum named entities (clients, dollar amounts, dates, locations, named processes, named people), required citations to authority publishers, and recommended JSON-LD schema markup types.

Authority publishers for citation purposes include: Statista, Pew Research, Gartner, Forrester, McKinsey, government data sources (BLS, Census, EU statistical offices), peer-reviewed research, industry-specific authoritative sources (HIMSS for healthcare, IDC for tech, Nielsen for media), and named company financial reports. Avoid suggesting low-authority aggregators like Wikipedia, generic blog roundups, or AI-generated content as citation sources.

Then call submit_brief_proposal with the complete structured output including ai_citation_landscape, atomic_question_map, and entity_data_requirements.`;

  const { system, version: resolvedPlaybookVersion, included } = await buildRoutedSystem(
    "propose_brief",
    brandId,
    stageInstructions,
    playbookVersion,
  );
  log.info({ sections: included }, "routed playbook sections");

  const metadataUserId = buildAnthropicUserId({
    pod: project.pod,
    stage: "stage0",
    substage: "propose_brief",
    writer_id: project.writerId,
  });

  const requestBody = JSON.stringify({
    model: MODEL,
    max_tokens: 8000,
    metadata: { user_id: metadataUserId },
    system,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
      PROPOSE_TOOL,
    ],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content:
          "HARD LIMIT: 3 web_search calls maximum across this entire task. Use them strategically (one for keyword/SERP, one for benchmark discovery, one for competitor discovery). After 3 searches you MUST synthesize and call submit_brief_proposal with whatever you have. Do not exceed 3 searches.",
      },
    ],
  });

  let resp: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 290_000);
      try {
        resp = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "web-search-2025-03-05",
            "content-type": "application/json",
          },
          body: requestBody,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (resp.status >= 500 || resp.status === 429) {
        const txt = await resp.text();
        log.warn({ attempt, status: resp.status, body: txt.slice(0, 300) }, "propose-brief: retryable status");
        lastErr = new Error(`Anthropic ${resp.status}`);
        resp = null;
      } else {
        break;
      }
    } catch (e) {
      lastErr = e;
      log.warn({ attempt, err: e instanceof Error ? e.message : String(e) }, "propose-brief: fetch error");
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  if (!resp) {
    const msg = `Anthropic request failed after retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`;
    await db.update(projectsTable).set({ status: "brief_failed", briefError: msg }).where(eq(projectsTable.id, project_id));
    throw new Error(msg);
  }
  if (!resp.ok) {
    const txt = await resp.text();
    const msg = `Anthropic ${resp.status}: ${txt.slice(0, 500)}`;
    await db.update(projectsTable).set({ status: "brief_failed", briefError: msg }).where(eq(projectsTable.id, project_id));
    throw new Error(msg);
  }

  const responseData = await resp.json() as any;
  await logUsage({
    project_id,
    stage: "propose_brief",
    model: MODEL,
    metadata_user_id: metadataUserId,
    usage: responseData.usage,
    ok: true,
  });

  const toolUse = (responseData.content || []).find(
    (b: any) => b.type === "tool_use" && b.name === "submit_brief_proposal",
  );
  if (!toolUse) {
    const text = (responseData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const msg = `No proposal returned. Raw: ${text.slice(0, 500)}`;
    await db.update(projectsTable).set({ status: "brief_failed", briefError: msg }).where(eq(projectsTable.id, project_id));
    throw new Error(msg);
  }

  const proposal = toolUse.input;
  const primary = (proposal.keyword_cluster || []).find((k: any) => k.is_primary);
  const benchmarkTop = (proposal.benchmark_candidates || []).sort((a: any, b: any) => a.rank - b.rank)[0];
  const competitorTop = (proposal.competitor_candidates || []).sort((a: any, b: any) => a.rank - b.rank)[0];

  await db.update(projectsTable).set({
    aiProposedBrief: proposal,
    keywordCluster: proposal.keyword_cluster || [],
    keyword: primary?.keyword || project.keyword,
    funnelStage: proposal.funnel_stage,
    icps: (proposal.icps || []).map((i: any) => i.id),
    pod: proposal.pod || project.pod,
    benchmarkUrl: benchmarkTop?.url || project.benchmarkUrl,
    competitorUrl: competitorTop?.url || project.competitorUrl,
    contentType: proposal.content_type || project.contentType,
    mode: proposal.mode || project.mode,
    playbookVersion: resolvedPlaybookVersion,
    status: "brief_proposed",
  }).where(eq(projectsTable.id, project_id));

  log.info({ project_id, playbookVersion }, "propose-brief: complete");
}
