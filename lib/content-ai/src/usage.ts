import { db, usageLogsTable } from "@workspace/db";

/**
 * Per-million-token pricing in USD. Update when Anthropic prices change.
 * Source: https://www.anthropic.com/pricing (Sonnet 4.5, Haiku 4.5).
 */
const PRICING: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.30 },
  "claude-haiku-4-5-20251001":  { input: 1, output: 5,  cache_write: 1.25, cache_read: 0.10 },
};

function priceFor(model: string) {
  return PRICING[model] ?? PRICING["claude-sonnet-4-5-20250929"]!;
}

export function estimateCost(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
): number {
  const p = priceFor(model);
  const cost =
    ((usage.input_tokens ?? 0) * p.input +
      (usage.output_tokens ?? 0) * p.output +
      (usage.cache_creation_input_tokens ?? 0) * p.cache_write +
      (usage.cache_read_input_tokens ?? 0) * p.cache_read) /
    1_000_000;
  return Number(cost.toFixed(6));
}

export async function logUsage(args: {
  project_id?: string | null;
  stage?: string | null;
  sub_stage?: string | null;
  model: string;
  metadata_user_id?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  duration_ms?: number;
  ok?: boolean;
  error?: string | null;
}): Promise<void> {
  try {
    const u = args.usage ?? {};
    const cost = estimateCost(args.model, u);
    await db.insert(usageLogsTable).values({
      projectId: args.project_id ?? null,
      stage: args.stage ?? null,
      subStage: args.sub_stage ?? null,
      model: args.model,
      metadataUserId: args.metadata_user_id ?? null,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      estimatedCostUsd: String(cost),
      durationMs: args.duration_ms ?? null,
      ok: args.ok !== false,
      error: args.error ?? null,
    });
  } catch (e) {
    console.warn("[usage] log failed:", e instanceof Error ? e.message : String(e));
  }
}
