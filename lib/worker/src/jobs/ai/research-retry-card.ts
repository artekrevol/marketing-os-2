import type { JobData } from "@workspace/jobs";
import {
  getSupabaseAdmin,
  runStage,
  prefetchPages,
  STAGE_KEYS,
  type StageKey,
} from "@workspace/content-ai";
import type { Logger } from "pino";

export async function handleAiResearchRetryCard(
  data: JobData<"ai.research-retry-card">,
  log: Logger,
): Promise<void> {
  const { project_id, stage } = data;
  const supabase = getSupabaseAdmin();

  if (!(STAGE_KEYS as readonly string[]).includes(stage)) {
    throw new Error(`invalid stage: ${stage}`);
  }

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .single();
  if (projErr || !project) throw new Error(`project not found: ${project_id}`);

  const pages = await prefetchPages(project);
  const result = await runStage({ project, stage: stage as StageKey, pages });

  if (!result.ok) {
    throw new Error(result.error ?? `stage ${stage} failed`);
  }

  log.info({ project_id, stage }, "research-retry-card: complete");
}
