import type { JobData } from "@workspace/jobs";
import {
  runStage,
  prefetchPages,
  STAGE_KEYS,
  STAGE_LABELS,
} from "@workspace/content-ai";
import { db, projectsTable, researchBriefsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

/** Map Drizzle camelCase project fields to snake_case for content-ai functions. */
function normalizeProject(p: Record<string, any>): Record<string, any> {
  return {
    ...p,
    brand_id: p.brandId,
    content_type: p.contentType,
    keyword_cluster: p.keywordCluster,
    funnel_stage: p.funnelStage,
    company_domain: p.companyDomain,
    competitor_url: p.competitorUrl,
    benchmark_url: p.benchmarkUrl,
    playbook_version: p.playbookVersion,
    ai_proposed_brief: p.aiProposedBrief,
    brief_confirmed_at: p.briefConfirmedAt,
    brief_error: p.briefError,
    user_notes: p.userNotes,
    user_overrides: p.userOverrides,
    created_by: p.createdBy,
    writer_id: p.writerId,
    current_stage: p.currentStage,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export async function handleAiResearchGenerate(
  data: JobData<"ai.research-generate">,
  log: Logger,
): Promise<void> {
  const { project_id } = data;

  const projectRows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, project_id))
    .limit(1);
  const project = projectRows[0];
  if (!project) throw new Error(`project not found: ${project_id}`);

  const proj = normalizeProject(project);

  // Initialize sub_status: every stage pending. Reset all stage columns to null on rerun.
  const initialSubStatus: Record<string, any> = {};
  for (const k of STAGE_KEYS) {
    initialSubStatus[k] = { status: "pending", label: STAGE_LABELS[k], error: null };
  }

  await db
    .insert(researchBriefsTable)
    .values({
      projectId: project_id,
      brandId: project.brandId,
      subStatus: initialSubStatus,
      proofPointsStatus: "pending",
      progressError: null,
      progressStage: 0,
      progressStatus: [],
      searchIntent: null,
      benchmarkTeardown: null,
      competitorTeardown: null,
      synergyMap: null,
      aiCitationLandscape: null,
      atomicQuestionMap: null,
      entityDataRequirements: null,
      angleInventory: null,
      conversionSignals: null,
    })
    .onConflictDoUpdate({
      target: researchBriefsTable.projectId,
      set: {
        subStatus: initialSubStatus,
        proofPointsStatus: "pending",
        progressError: null,
        progressStage: 0,
        progressStatus: [],
        searchIntent: null,
        benchmarkTeardown: null,
        competitorTeardown: null,
        synergyMap: null,
        aiCitationLandscape: null,
        atomicQuestionMap: null,
        entityDataRequirements: null,
        angleInventory: null,
        conversionSignals: null,
      },
    });

  log.info({ project_id }, "research-generate: starting parallel stages");

  const t0 = Date.now();
  const pages = await prefetchPages(proj);
  log.info({ ms: Date.now() - t0 }, "research-generate: prefetch done");

  const results = await Promise.allSettled(
    STAGE_KEYS.map((stage) => runStage({ project: proj, stage, pages })),
  );

  const okCount = results.filter((r) => r.status === "fulfilled" && (r.value as any).ok).length;
  log.info({ project_id, ok: okCount, total: STAGE_KEYS.length }, "research-generate: done");

  await db
    .update(projectsTable)
    .set({ status: okCount === STAGE_KEYS.length ? "research_ready" : "research_partial" })
    .where(eq(projectsTable.id, project_id));

  if (okCount < STAGE_KEYS.length) {
    const failedStages = STAGE_KEYS.filter((_, i) => {
      const r = results[i];
      return r?.status === "rejected" || (r?.status === "fulfilled" && !(r.value as any).ok);
    });
    log.warn({ failedStages }, "research-generate: some stages failed");
  }
}
