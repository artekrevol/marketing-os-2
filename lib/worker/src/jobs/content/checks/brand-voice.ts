import { eq } from "drizzle-orm";
import { withBrandScope, brandsTable, type Brand } from "@workspace/db";
import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";
import { loadEnv } from "../../../env";

/**
 * Warn-level check: brand-voice match confidence.
 *
 * Implementation: read the brand's `voice_profile` (jsonb) from
 * `public.brands`, send it to OpenAI alongside an excerpt of the body,
 * and parse a 0–1 score from a JSON-mode response. The model is
 * pinned to `gpt-4o-mini` for cost; the response_format is
 * `json_object` so we don't have to do free-text parsing. On any
 * upstream error we surface `outcome="error"` with the error message
 * in `details.error` rather than masking it as a pass.
 */

const MODEL = "gpt-4o-mini";
const EXCERPT_CHARS = 6000;

export async function runBrandVoiceCheck(
  input: CheckRunInput,
  log: Logger,
): Promise<CheckRunResult> {
  const threshold = input.threshold ?? 0.7;

  const words = (input.bodyMd.match(/\b[\w'-]+\b/g) ?? []).length;
  if (words < 80) {
    return {
      outcome: "fail",
      score: null,
      threshold,
      summary: "Brand voice: body too short (<80 words) for confident scoring.",
      details: { reason: "too_short", wordCount: words },
    };
  }

  const brand = await withBrandScope(input.brandId, async ({ db }) => {
    const rows = (await db
      .select()
      .from(brandsTable)
      .where(eq(brandsTable.id, input.brandId))
      .limit(1)) as Brand[];
    return rows[0] ?? null;
  });
  if (!brand) {
    return {
      outcome: "error",
      score: null,
      threshold,
      summary: `Brand voice: brand ${input.brandId} not found.`,
      details: { error: "brand_not_found" },
    };
  }

  const voiceProfile = (brand.voiceProfile ?? {}) as Record<string, unknown>;
  const excerpt = input.bodyMd.slice(0, EXCERPT_CHARS);

  let parsed: { score?: number; reasoning?: string; flags?: string[] } | null = null;
  try {
    parsed = await scoreVoiceWithOpenAI({
      voiceProfile,
      excerpt,
      brandName: brand.name,
    });
  } catch (err) {
    log.error({ err }, "brand-voice: OpenAI call failed");
    return {
      outcome: "error",
      score: null,
      threshold,
      summary: `Brand voice: OpenAI call failed — ${(err as Error).message}`,
      details: { error: (err as Error).message },
    };
  }

  const rawScore = typeof parsed?.score === "number" ? parsed.score : NaN;
  if (!Number.isFinite(rawScore)) {
    return {
      outcome: "error",
      score: null,
      threshold,
      summary: "Brand voice: OpenAI response missing numeric score.",
      details: { error: "no_score", parsed },
    };
  }
  const score = Math.max(0, Math.min(1, rawScore));
  const passed = score >= threshold;
  return {
    outcome: passed ? "pass" : "fail",
    score: Math.round(score * 1000) / 1000,
    threshold,
    summary: passed
      ? `Voice confidence ${(score * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%.`
      : `Voice confidence ${(score * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% — review tone.`,
    details: {
      model: MODEL,
      reasoning: parsed.reasoning ?? null,
      flags: parsed.flags ?? [],
      voiceProfileKeys: Object.keys(voiceProfile),
      excerptChars: excerpt.length,
    },
  };
}

async function scoreVoiceWithOpenAI(args: {
  voiceProfile: Record<string, unknown>;
  excerpt: string;
  brandName: string;
}): Promise<{ score: number; reasoning?: string; flags?: string[] }> {
  const system =
    "You are a brand voice auditor. Given a brand's voice_profile JSON " +
    "and a draft excerpt, return a JSON object: " +
    `{"score": <0..1 float>, "reasoning": "<one short sentence>", "flags": ["<violation tag>", ...]}. ` +
    "score=1 means the excerpt matches the voice profile perfectly; " +
    "score=0 means it ignores or contradicts it. Be strict but fair.";

  const user = JSON.stringify({
    brand: args.brandName,
    voice_profile: args.voiceProfile,
    excerpt: args.excerpt,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loadEnv().OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openai ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai: empty response content");
  const parsed = JSON.parse(content) as {
    score?: number;
    reasoning?: string;
    flags?: string[];
  };
  if (typeof parsed.score !== "number") {
    throw new Error("openai: no score in response");
  }
  return parsed as { score: number; reasoning?: string; flags?: string[] };
}
