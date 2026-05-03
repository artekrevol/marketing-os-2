import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Initialize Sentry for the worker process.
 *
 * The `environment` tag is composed as `${nodeEnv}:worker` so dashboards
 * can clearly separate worker traces from the API/web tiers (which run
 * with the same NODE_ENV but a different service). The `service: "worker"`
 * tag and `tier: "worker"` context are also set on the initial scope so
 * filters like `tags.service:worker` work in Sentry's UI.
 */
export function initSentry(dsn: string, nodeEnv: string): void {
  if (initialized) return;
  Sentry.init({
    dsn,
    environment: `${nodeEnv}:worker`,
    tracesSampleRate: 0,
    serverName: "seo-os-worker",
    initialScope: {
      tags: {
        service: "worker",
        nodeEnv,
      },
      contexts: {
        tier: { name: "worker" },
      },
    },
  });
  initialized = true;
}

export function captureJobError(
  err: unknown,
  ctx: {
    jobId: string;
    jobName: string;
    queueName: string;
    attempt: number;
    brandId?: string | null;
  },
): void {
  Sentry.withScope((scope) => {
    scope.setTags({
      jobName: ctx.jobName,
      queueName: ctx.queueName,
      ...(ctx.brandId ? { brandId: ctx.brandId } : {}),
    });
    scope.setContext("job", { ...ctx });
    Sentry.captureException(err);
  });
}

export { Sentry };
