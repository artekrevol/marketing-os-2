import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  PORT: z
    .string()
    .default("3001")
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n) && n > 0, "PORT must be a positive number"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  DATAFORSEO_LOGIN: z.string().min(1),
  DATAFORSEO_PASSWORD: z.string().min(1),
  ORIGINALITY_AI_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  SENTRY_DSN: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type WorkerEnv = z.infer<typeof Schema>;

let _env: WorkerEnv | null = null;

export function loadEnv(): WorkerEnv {
  if (_env) return _env;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Print to stderr because the logger may itself depend on env.
    console.error(`[worker] invalid environment:\n${issues}`);
    process.exit(1);
  }
  _env = parsed.data;
  return _env;
}
