import type { JobData } from "@workspace/jobs";
import {
  getSupabaseAdmin,
  runStage,
  prefetchPages,
  STAGE_KEYS,
  STAGE_LABELS,
} from "@workspace/content-ai";
import type { Logger } from "pino";

export async function handleAiResearchGenerate(
  data: JobData<"ai.research-generate">,
  log: Logger,
): Promise<void> {
  const { project_id } = data;
  const supabase = getSupabaseAdmin();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", project_id)
    .single();
  if (projErr || !project) throw new Error(`project not found: ${project_id}`);

  // Initialize sub_status: every stage pending. Reset all stage columns to null on rerun.
  const initialSubStatus: Record<string, any> = {};
  for (const k of STAGE_KEYS) {
    initialSubStatus[k] = { status: "pending", label: STAGE_LABELS[k], error: null };
  }

  await supabase.from("research_briefs").upsert(
    {
      project_id,
      sub_status: initialSubStatus,
      proof_points_status: "pending",
      progress_error: null,
      progress_stage: 0,
      progress_status: [],
      search_intent: null,
      benchmark_teardown: null,
      competitor_teardown: null,
      synergy_map: null,
      ai_citation_landscape: null,
      atomic_question_map: null,
      entity_data_requirements: null,
      angle_inventory: null,
      conversion_signals: null,
    },
    { onConflict: "project_id" } as any,
  );

  log.info({ project_id }, "research-generate: starting parallel stages");

  const t0 = Date.now();
  const pages = await prefetchPages(project);
  log.info({ ms: Date.now() - t0 }, "research-generate: prefetch done");

  const results = await Promise.allSettled(
    STAGE_KEYS.map((stage) => runStage({ project, stage, pages })),
  );

  const okCount = results.filter((r) => r.status === "fulfilled" && (r.value as any).ok).length;
  log.info({ project_id, ok: okCount, total: STAGE_KEYS.length }, "research-generate: done");

  await supabase
    .from("projects")
    .update({
      status: okCount === STAGE_KEYS.length ? "research_ready" : "research_partial",
    } as any)
    .eq("id", project_id);

  if (okCount < STAGE_KEYS.length) {
    const failedStages = STAGE_KEYS.filter((_, i) => {
      const r = results[i];
      return r?.status === "rejected" || (r?.status === "fulfilled" && !(r.value as any).ok);
    });
    log.warn({ failedStages }, "research-generate: some stages failed");
  }
}
