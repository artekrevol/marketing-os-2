import { eq } from "drizzle-orm";
import { withBrandScope } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";

/**
 * Warn-level check: brief compliance — the fraction of brief talking
 * points that appear in the body.
 *
 * Sprint 3 Part 1 reads the most recent `research_briefs.bullets`
 * (jsonb array of strings) for the same project_id as the
 * content_object. Each bullet is normalized and the body is fuzzy-
 * searched for it; coverage = matches / total. If no brief exists
 * (older projects), we return a "skip" outcome (`pass`, score=null,
 * with details.skipped=true).
 *
 * Reads the brief through a raw SQL select inside `withBrandScope`
 * because the worker doesn't carry a Drizzle mirror of research_briefs;
 * the table belongs to the Sprint 1 schema and is brand-scoped (RLS-
 * protected via the same is_admin / current_user_brand_access gate).
 */
export async function runBriefComplianceCheck(
  input: CheckRunInput,
  log: Logger,
): Promise<CheckRunResult> {
  const threshold = input.threshold ?? 0.8;

  const bullets = await withBrandScope(input.brandId, async ({ db }) => {
    const result = (await db.execute(
      sql`select rb.bullets
            from public.research_briefs rb
            join public.content_objects co
              on co.project_id = rb.project_id
           where co.id = ${input.contentObjectId}::uuid
             and co.brand_id = ${input.brandId}::uuid
           order by rb.created_at desc
           limit 1`,
    )) as unknown as { rows?: Array<{ bullets: unknown }> } | Array<{ bullets: unknown }>;
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    if (rows.length === 0) return null;
    const raw = rows[0]!.bullets;
    if (Array.isArray(raw)) return raw.map((b: unknown) => String(b));
    return null;
  });

  if (!bullets || bullets.length === 0) {
    log.info("brief-compliance: no research_briefs row found, skipping");
    return {
      outcome: "pass",
      score: null,
      threshold,
      summary: "No research brief found — coverage check skipped.",
      details: { skipped: true, reason: "no_brief" },
    };
  }

  const haystack = input.bodyMd.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];
  for (const b of bullets) {
    const norm = b.trim().toLowerCase();
    if (!norm) continue;
    if (matchesBullet(haystack, norm)) hits.push(b);
    else misses.push(b);
  }

  const total = hits.length + misses.length;
  if (total === 0) {
    return {
      outcome: "pass",
      score: null,
      threshold,
      summary: "Brief found but contained no usable bullets — coverage check skipped.",
      details: { skipped: true, reason: "empty_bullets" },
    };
  }
  const coverage = hits.length / total;
  const passed = coverage >= threshold;
  return {
    outcome: passed ? "pass" : "fail",
    score: Math.round(coverage * 1000) / 1000,
    threshold,
    summary: passed
      ? `Brief coverage ${(coverage * 100).toFixed(0)}% ≥ ${(threshold * 100).toFixed(0)}%.`
      : `Brief coverage ${(coverage * 100).toFixed(0)}% below ${(threshold * 100).toFixed(0)}%.`,
    details: { totalBullets: total, hits, misses },
  };
}

/**
 * Cheap "does the body cover this bullet?" heuristic. Strips bullet
 * punctuation, then requires that at least 60% of the bullet's
 * non-stopword tokens appear in the body. Tunable; deliberately
 * forgiving so reviewers don't have to fight the scorer.
 */
const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","is","are",
  "be","by","this","that","these","those","it","its","as","at","from",
]);

function matchesBullet(body: string, bullet: string): boolean {
  const tokens = bullet
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  if (tokens.length === 0) return body.includes(bullet);
  const hits = tokens.filter((t) => body.includes(t)).length;
  return hits / tokens.length >= 0.6;
}
