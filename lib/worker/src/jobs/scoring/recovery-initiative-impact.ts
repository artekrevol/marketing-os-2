import type { JobData } from "@workspace/jobs";
import type { jobLogger } from "../../logger";

/**
 * Compute `recovery_initiatives.actual_impact_clicks_14d` 14 days
 * after `completeInitiative`. Stub for now — the full implementation
 * lands with the snapshot pipeline (Recovery Prompt 4). Returning
 * `{ skipped: true }` lets the BullMQ retry/dlq path treat the job as
 * handled until the real computation ships.
 */
export async function handleRecoveryInitiativeImpact(
  data: JobData<"scoring.recovery-initiative-impact">,
  log: ReturnType<typeof jobLogger>,
): Promise<{ skipped: true; reason: string }> {
  log.info(
    { initiativeId: data.initiativeId, brandId: data.brandId },
    "recovery-initiative-impact: stub handler — actual-impact computation lands with Prompt 4",
  );
  return { skipped: true, reason: "not_implemented_until_prompt_4" };
}
