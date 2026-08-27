import type { JobData } from "@workspace/jobs";
import {
  runStage,
  prefetchPages,
  recordPrefetchStatus,
  STAGE_KEYS,
  STAGE_LABELS,
} from "@workspace/content-ai";
import {
  projectsTable,
  researchBriefsTable,
  withBrandScope,
  type Project,
} from "@workspace/db";
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
  const { project_id, brandId } = data;
  const playbookVersion = (data as { playbookVersion?: number }).playbookVersion;
  if (!brandId) throw new Error(`ai.research-generate: brandId is required for project ${project_id}`);

  const projectRows = await withBrandScope(brandId, ({ scoped }) =>
    scoped.select(projectsTable, {
      where: eq(projectsTable.id, project_id),
      limit: 1,
    }),
  );
  const project = (projectRows as Project[])[0];
  if (!project) throw new Error(`project not found: ${project_id}`);

  const proj = normalizeProject(project);

  // Initialize sub_status: every stage pending. Reset all stage columns to null on rerun.
  const initialSubStatus: Record<string, any> = {};
  for (const k of STAGE_KEYS) {
    initialSubStatus[k] = { status: "pending", label: STAGE_LABELS[k], error: null };
  }

  await withBrandScope(brandId, async ({ scoped }) => {
    const values = {
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
    };
    await scoped.insert(researchBriefsTable, values, { onConflict: "doNothing" });
    await scoped.update(researchBriefsTable, {
      subStatus: values.subStatus,
      proofPointsStatus: values.proofPointsStatus,
      progressError: values.progressError,
      progressStage: values.progressStage,
      progressStatus: values.progressStatus,
      searchIntent: values.searchIntent,
      benchmarkTeardown: values.benchmarkTeardown,
      competitorTeardown: values.competitorTeardown,
      synergyMap: values.synergyMap,
      aiCitationLandscape: values.aiCitationLandscape,
      atomicQuestionMap: values.atomicQuestionMap,
      entityDataRequirements: values.entityDataRequirements,
      angleInventory: values.angleInventory,
      conversionSignals: values.conversionSignals,
    }, eq(researchBriefsTable.projectId, project_id));
  });

  log.info({ project_id }, "research-generate: starting parallel stages");

  const t0 = Date.now();
  const pages = await prefetchPages(proj);
  log.info(
    {
      ms: Date.now() - t0,
      benchmark: pages.benchmark ? { ok: pages.benchmark.ok, bytes: pages.benchmark.bytes, http: pages.benchmark.httpStatus, error: pages.benchmark.error } : null,
      competitor: pages.competitor ? { ok: pages.competitor.ok, bytes: pages.competitor.bytes, http: pages.competitor.httpStatus, error: pages.competitor.error } : null,
      company: pages.company ? { ok: pages.company.ok, bytes: pages.company.bytes, http: pages.company.httpStatus, error: pages.company.error } : null,
    },
    "research-generate: prefetch done",
  );
  await recordPrefetchStatus(project_id, brandId, pages);

  const results = await Promise.allSettled(
    STAGE_KEYS.map((stage) => runStage({ project: proj, stage, pages, playbookVersion })),
  );

  const okCount = results.filter((r) => r.status === "fulfilled" && (r.value as any).ok).length;
  log.info({ project_id, ok: okCount, total: STAGE_KEYS.length }, "research-generate: done");

  await withBrandScope(brandId, ({ scoped }) =>
    scoped.update(
      projectsTable,
      { status: okCount === STAGE_KEYS.length ? "research_ready" : "research_partial" },
      eq(projectsTable.id, project_id),
    ),
  );

  if (okCount < STAGE_KEYS.length) {
    const failedStages = STAGE_KEYS.filter((_, i) => {
      const r = results[i];
      return r?.status === "rejected" || (r?.status === "fulfilled" && !(r.value as any).ok);
    });
    const errorSummary = failedStages
      .map((k) => {
        const i = STAGE_KEYS.indexOf(k);
        const r = results[i];
        if (r?.status === "rejected") {
          return `${k}: ${(r.reason as Error)?.message ?? "rejected"}`;
        }
        return `${k}: failed`;
      })
      .join("; ");
    log.warn({ failedStages, errorSummary }, "research-generate: some stages failed");

    // Surface failure details into the research brief row so the
    // frontend can show an actionable message instead of empty sections.
    await withBrandScope(brandId, ({ scoped }) =>
      scoped.update(researchBriefsTable, {
        progressError: `Research incomplete — ${failedStages.length} of ${STAGE_KEYS.length} stages failed: ${errorSummary}`,
      }, eq(researchBriefsTable.projectId, project_id)),
    );
  }
}
