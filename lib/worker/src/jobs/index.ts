import type { Job } from "bullmq";
import type { JobName, JobData } from "@workspace/jobs";
import { JOB_REGISTRY } from "@workspace/jobs";
import { jobLogger } from "../logger";
import { handleHeartbeat } from "./heartbeat";
import { handleDataForSeoSerpTest } from "./dataforseo-test";
import { handleOriginalityScanTest } from "./originality-test";
import { handleQaRunChecks } from "./content/qa-run-checks";
import { handleRecoveryInitiativeImpact } from "./scoring/recovery-initiative-impact";
import {
  handleRecoverySnapshot,
  handleRecoverySnapshotNightly,
} from "./scoring/recovery-snapshot";
import { handleAiProposeBrief } from "./ai/propose-brief";
import { handleAiResearchGenerate } from "./ai/research-generate";
import { handleAiResearchRetryCard } from "./ai/research-retry-card";
import { handleSeoCrawlRun } from "./seo/crawl-run";
import { handleSeoRankCheckScheduled } from "./seo/rank-check-scheduled";
import { handleSeoCompetitorDiscover } from "./seo/competitor-discover";
import { handleSeoCompetitorInsightsCompute } from "./seo/competitor-insights-compute";
import { handlePublishLinkKeyword } from "./content/publish-link-keyword";
import {
  handleSeoRefreshContentContext,
  handleSeoRefreshContentContextNightly,
} from "./seo/refresh-content-context";

type Handler<N extends JobName> = (data: JobData<N>, log: ReturnType<typeof jobLogger>) => Promise<unknown>;

export const HANDLERS: { [N in JobName]: Handler<N> } = {
  "maintenance.heartbeat-noop": handleHeartbeat,
  "integrations.dataforseo-serp-test": handleDataForSeoSerpTest,
  "integrations.originality-ai-scan-test": handleOriginalityScanTest,
  "content.qa-run-checks": handleQaRunChecks,
  "scoring.recovery-initiative-impact": handleRecoveryInitiativeImpact,
  "scoring.recovery-snapshot": handleRecoverySnapshot,
  "scoring.recovery-snapshot-nightly": handleRecoverySnapshotNightly,
  "ai.propose-brief": handleAiProposeBrief,
  "ai.research-generate": handleAiResearchGenerate,
  "ai.research-retry-card": handleAiResearchRetryCard,
  "seo.crawl.run": handleSeoCrawlRun,
  "seo.rank-check.scheduled": handleSeoRankCheckScheduled,
  "seo.competitor.discover": handleSeoCompetitorDiscover,
  "seo.competitor-insights.compute": handleSeoCompetitorInsightsCompute,
  "content.publish-link-keyword": handlePublishLinkKeyword,
  "seo.refresh-content-context": handleSeoRefreshContentContext,
  "seo.refresh-content-context-nightly": handleSeoRefreshContentContextNightly,
};

/**
 * Dispatch a BullMQ Job to its registered handler. Validates the
 * payload against the job's zod schema before invoking the handler so
 * a corrupted enqueue can't crash the worker mid-handler.
 */
export async function dispatch(job: Job, queueName: string): Promise<unknown> {
  const name = job.name as JobName;
  const entry = JOB_REGISTRY[name];
  if (!entry) {
    throw new Error(`worker: no handler registered for ${name}`);
  }
  const data = entry.schema.parse(job.data);
  const log = jobLogger({
    jobId: job.id ?? "<unknown>",
    jobName: name,
    queueName,
    attempt: job.attemptsMade ?? 0,
    brandId: (data as { brandId?: string }).brandId ?? null,
  });
  log.info("job: started");
  try {
    const result = await (HANDLERS[name] as Handler<JobName>)(data, log);
    log.info({ result }, "job: completed");
    return result;
  } catch (err) {
    log.error({ err }, "job: handler threw");
    throw err;
  }
}
