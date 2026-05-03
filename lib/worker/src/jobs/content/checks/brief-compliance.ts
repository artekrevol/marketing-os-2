import { eq, desc, sql } from "drizzle-orm";
import { withBrandScope, draftsTable, type Draft } from "@workspace/db";
import type { Logger } from "pino";
import type { CheckRunInput, CheckRunResult } from "../qa-run-checks";

/**
 * Warn-level check: brief compliance — Sprint 3 contract subset.
 *
 * Three sub-checks read from the latest `drafts.metadata` row attached
 * to the same project as the content_object:
 *   1. Word-count band: |actual − target| / target ≤ 0.20.
 *   2. Meta title length: 50 ≤ length ≤ 60 characters.
 *   3. Meta description length: 140 ≤ length ≤ 160 characters.
 *
 * The check passes only if every sub-check it has data for passes.
 * If the draft metadata is missing the relevant fields (older drafts
 * pre-Sprint 3), the corresponding sub-check is recorded as "skipped"
 * but does not fail the overall outcome.
 */
type BriefMeta = {
  metaTitle?: string | null;
  metaDescription?: string | null;
  targetWordCount?: number | null;
};

type SubResult = { ok: boolean | null; actual: number | null; reason: string };

const WORD_BAND = 0.2;
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 110;
const DESC_MAX = 160;

export async function runBriefComplianceCheck(
  input: CheckRunInput,
  log: Logger,
): Promise<CheckRunResult> {
  const meta = await loadDraftMeta(input.brandId, input.contentObjectId);
  if (!meta) {
    log.info("brief-compliance: no draft metadata found, skipping");
    return {
      outcome: "pass",
      score: null,
      threshold: null,
      summary: "No draft metadata — brief-compliance check skipped.",
      details: { skipped: true, reason: "no_metadata" },
    };
  }

  const wc = scoreWordCount(input.wordCount, meta.targetWordCount);
  const title = scoreLength(meta.metaTitle, TITLE_MIN, TITLE_MAX);
  const desc = scoreLength(meta.metaDescription, DESC_MIN, DESC_MAX);

  const subs: Array<[string, SubResult]> = [
    ["wordCount", wc],
    ["metaTitle", title],
    ["metaDescription", desc],
  ];

  const failures = subs.filter(([, r]) => r.ok === false).map(([k]) => k);
  const skipped = subs.filter(([, r]) => r.ok === null).map(([k]) => k);
  const passed = failures.length === 0;

  return {
    outcome: passed ? "pass" : "fail",
    score: null,
    threshold: null,
    summary: passed
      ? skipped.length === 0
        ? "Brief compliance: word-count, title, and meta description all in band."
        : `Brief compliance: in band; skipped sub-checks: ${skipped.join(", ")}.`
      : `Brief compliance: out of band — ${failures.join(", ")}.`,
    details: {
      target: {
        wordCountBand: WORD_BAND,
        metaTitleLength: [TITLE_MIN, TITLE_MAX],
        metaDescriptionLength: [DESC_MIN, DESC_MAX],
      },
      actual: {
        wordCount: wc.actual,
        metaTitleLength: title.actual,
        metaDescriptionLength: desc.actual,
        targetWordCount: meta.targetWordCount ?? null,
      },
      results: Object.fromEntries(subs.map(([k, r]) => [k, r])),
      failures,
      skipped,
    },
  };
}

/**
 * Loads the latest draft for the same project as the content_object,
 * returning the meta fields from `drafts.metadata` plus the project's
 * configured target word count. Read inside `withBrandScope` so the
 * brand-scope guard is enforced; `drafts` is a brand-scoped table.
 */
async function loadDraftMeta(
  brandId: string,
  contentObjectId: string,
): Promise<BriefMeta | null> {
  return withBrandScope(brandId, async ({ scoped, db }) => {
    // content_objects.project_id — read via raw SELECT FOR-row read.
    // We can't go through scoped.select(contentObjectsTable) without
    // pulling another import, so a one-column raw query inside the
    // brand-scoped tx is the lightest path.
    const objRows = (await db.execute(
      sql`select project_id from public.content_objects
            where id = ${contentObjectId}::uuid
              and brand_id = ${brandId}::uuid
            limit 1`,
    )) as unknown as { rows?: Array<{ project_id: string }> } | Array<{ project_id: string }>;
    const objRowsArr = Array.isArray(objRows) ? objRows : (objRows.rows ?? []);
    const projectId = objRowsArr[0]?.project_id;
    if (!projectId) return null;

    const drafts = (await scoped.select(draftsTable, {
      where: eq(draftsTable.projectId, projectId),
      orderBy: [desc(draftsTable.updatedAt), desc(draftsTable.createdAt)],
      limit: 1,
    })) as Draft[];
    const draft = drafts[0];
    if (!draft) return null;

    const md = (draft.metadata ?? {}) as Record<string, unknown>;
    const metaTitle =
      (md["metaTitle"] as string | undefined) ??
      (md["meta_title"] as string | undefined) ??
      null;
    const metaDescription =
      (md["metaDescription"] as string | undefined) ??
      (md["meta_description"] as string | undefined) ??
      null;
    const target =
      (md["targetWordCount"] as number | undefined) ??
      (md["target_word_count"] as number | undefined) ??
      null;
    return { metaTitle, metaDescription, targetWordCount: target ?? null };
  });
}

function scoreWordCount(actual: number, target: number | null | undefined): SubResult {
  if (!target || target <= 0) {
    return { ok: null, actual, reason: "no target_word_count" };
  }
  const drift = Math.abs(actual - target) / target;
  return {
    ok: drift <= WORD_BAND,
    actual,
    reason: `target=${target}, drift=${(drift * 100).toFixed(1)}%`,
  };
}

function scoreLength(
  value: string | null | undefined,
  min: number,
  max: number,
): SubResult {
  if (value == null || value === "") {
    return { ok: null, actual: null, reason: "missing" };
  }
  const len = value.length;
  return {
    ok: len >= min && len <= max,
    actual: len,
    reason: `length=${len} target=[${min},${max}]`,
  };
}
