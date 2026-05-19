import type { JobData } from "@workspace/jobs";
import {
  runStage,
  prefetchPages,
  STAGE_KEYS,
  type StageKey,
} from "@workspace/content-ai";
import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";

export async function handleAiResearchRetryCard(
  data: JobData<"ai.research-retry-card">,
  log: Logger,
): Promise<void> {
  const { project_id, stage } = data;

  if (!(STAGE_KEYS as readonly string[]).includes(stage)) {
    throw new Error(`invalid stage: ${stage}`);
  }

  const projectRows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, project_id))
    .limit(1);
  const project = projectRows[0];
  if (!project) throw new Error(`project not found: ${project_id}`);

  // Normalize Drizzle camelCase to snake_case for content-ai functions.
  const proj = {
    ...project,
    brand_id: project.brandId,
    content_type: project.contentType,
    keyword_cluster: project.keywordCluster,
    funnel_stage: project.funnelStage,
    company_domain: project.companyDomain,
    competitor_url: project.competitorUrl,
    benchmark_url: project.benchmarkUrl,
    writer_id: project.writerId,
    current_stage: project.currentStage,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };

  const pages = await prefetchPages(proj);
  const result = await runStage({ project: proj, stage: stage as StageKey, pages });

  if (!result.ok) {
    throw new Error(result.error ?? `stage ${stage} failed`);
  }

  log.info({ project_id, stage }, "research-retry-card: complete");
}
