import pino, { type Logger } from "pino";

const isProduction = process.env["NODE_ENV"] === "production";

// Default log level by environment: `debug` in development for verbose
// trace info during local iteration, `info` in production to keep log
// volume (and Railway egress cost) reasonable. `LOG_LEVEL` always wins
// when set, so on-call can dial verbosity up/down without a redeploy.
const defaultLevel = isProduction ? "info" : "debug";
const level = process.env["LOG_LEVEL"] ?? defaultLevel;

export const logger: Logger = pino({
  level,
  base: { service: "seo-os-worker" },
  redact: ["env.DATABASE_URL", "env.REDIS_URL", "headers.authorization"],
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
