import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(dsn: string, env: string): void {
  if (initialized) return;
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: 0,
    serverName: "seo-os-worker",
    initialScope: { tags: { service: "seo-os-worker" } },
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
