import pino, { type Logger } from "pino";

const isProduction = process.env["NODE_ENV"] === "production";

export const logger: Logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { service: "seo-os-worker" },
  redact: ["env.DATABASE_URL", "env.REDIS_URL", "env.SUPABASE_SERVICE_ROLE_KEY", "headers.authorization"],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export function jobLogger(args: {
  jobId: string;
  jobName: string;
  queueName: string;
  attempt: number;
  brandId?: string | null;
}): Logger {
  return logger.child(args);
}
