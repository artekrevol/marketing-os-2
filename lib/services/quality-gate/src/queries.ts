import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  withBrandScope,
  contentObjectsTable,
  qaRunsTable,
  qaCheckResultsTable,
  qaCheckDefinitionsTable,
  qaSignoffsTable,
  qaOverridesTable,
  type ContentObject,
  type QaRun,
  type QaCheckResult,
  type QaSignoff,
  type QaOverride,
} from "@workspace/db";
import type { ContentStatus, CheckName } from "./types";

/** Reviewer-queue row: content_object + latest qa_run summary. */
export interface QueueRow {
  id: string;
  title: string;
  projectId: string;
  status: ContentStatus;
  submittedAt: string | null;
  updatedAt: string;
  wordCount: number;
  qaRunId: string | null;
  qaStatus: string | null;
  qaStartedAt: string | null;
  qaCompletedAt: string | null;
  summary: Record<string, unknown>;
}

/** Reviewer queue: everything in {submitted, in_review} for the brand. */
export async function listReviewerQueue(brandId: string): Promise<QueueRow[]> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const objs = (await scoped.select(contentObjectsTable, {
      where: inArray(contentObjectsTable.status, ["submitted", "in_review"]),
      orderBy: desc(contentObjectsTable.submittedAt),
    })) as ContentObject[];

    if (objs.length === 0) return [];

    const runs = (await scoped.select(qaRunsTable, {
      where: inArray(
        qaRunsTable.contentObjectId,
        objs.map((o) => o.id),
      ),
      orderBy: desc(qaRunsTable.createdAt),
    })) as QaRun[];

    const latestByObj = new Map<string, QaRun>();
    for (const r of runs) {
      if (!latestByObj.has(r.contentObjectId)) latestByObj.set(r.contentObjectId, r);
    }

    return objs.map((o) => {
      const r = latestByObj.get(o.id);
      return {
        id: o.id,
        title: o.title,
        projectId: o.projectId,
        status: o.status as ContentStatus,
        submittedAt: o.submittedAt ? o.submittedAt.toISOString() : null,
        updatedAt: o.updatedAt.toISOString(),
        wordCount: o.wordCount,
        qaRunId: r?.id ?? null,
        qaStatus: r?.status ?? null,
        qaStartedAt: r?.startedAt ? r.startedAt.toISOString() : null,
        qaCompletedAt: r?.completedAt ? r.completedAt.toISOString() : null,
        summary: (r?.summary as Record<string, unknown>) ?? {},
      };
    });
  });
}

/** Full review surface: object + latest qa_run + checks + signoffs + overrides. */
export interface ReviewDetail {
  object: ContentObject;
  qaRun: QaRun | null;
  checks: QaCheckResult[];
  signoffs: QaSignoff[];
  overrides: QaOverride[];
}

export async function getReviewDetail(
  brandId: string,
  contentObjectId: string,
): Promise<ReviewDetail | null> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0];
    if (!obj) return null;

    const runs = (await scoped.select(qaRunsTable, {
      where: eq(qaRunsTable.contentObjectId, contentObjectId),
      orderBy: desc(qaRunsTable.createdAt),
      limit: 1,
    })) as QaRun[];
    const run = runs[0] ?? null;

    const checks = run
      ? ((await scoped.select(qaCheckResultsTable, {
          where: eq(qaCheckResultsTable.qaRunId, run.id),
        })) as QaCheckResult[])
      : [];

    const signoffs = (await scoped.select(qaSignoffsTable, {
      where: eq(qaSignoffsTable.contentObjectId, contentObjectId),
      orderBy: desc(qaSignoffsTable.createdAt),
    })) as QaSignoff[];

    const overrides = run
      ? ((await scoped.select(qaOverridesTable, {
          where: eq(qaOverridesTable.qaRunId, run.id),
        })) as QaOverride[])
      : [];

    return { object: obj, qaRun: run, checks, signoffs, overrides };
  });
}

/** Look up every enabled check definition for the brand. */
export async function getCheckDefinitions(
  brandId: string,
): Promise<Map<CheckName, typeof qaCheckDefinitionsTable.$inferSelect>> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(qaCheckDefinitionsTable, {
      where: eq(qaCheckDefinitionsTable.enabled, true),
    })) as Array<typeof qaCheckDefinitionsTable.$inferSelect>;
    const map = new Map<CheckName, (typeof rows)[number]>();
    for (const r of rows) map.set(r.checkName as CheckName, r);
    return map;
  });
}

/** Used by the worker to load body + word_count for the QA pipeline. */
export async function getContentObjectForChecks(
  brandId: string,
  contentObjectId: string,
): Promise<{
  id: string;
  brandId: string;
  projectId: string;
  bodyMd: string;
  wordCount: number;
  title: string;
} | null> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const objs = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const obj = objs[0];
    if (!obj) return null;
    return {
      id: obj.id,
      brandId: obj.brandId,
      projectId: obj.projectId,
      bodyMd: obj.bodyMd,
      wordCount: obj.wordCount,
      title: obj.title,
    };
  });
}

/** Reads, for the API: the latest qa_run for an object across all states. */
export async function getLatestQaRun(brandId: string, contentObjectId: string) {
  return withBrandScope(brandId, async ({ scoped }) => {
    const rs = (await scoped.select(qaRunsTable, {
      where: eq(qaRunsTable.contentObjectId, contentObjectId),
      orderBy: desc(qaRunsTable.createdAt),
      limit: 1,
    })) as QaRun[];
    return rs[0] ?? null;
  });
}

/**
 * Narrow self-fetch exception: did the caller submit this particular
 * content_object? Used by the API to let writers poll their own
 * submission status through the same /review/:id endpoint reviewers
 * use, without granting them general queue read access.
 */
export async function callerSubmittedContentObject(
  brandId: string,
  contentObjectId: string,
  userId: string,
): Promise<boolean> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(contentObjectsTable, {
      where: eq(contentObjectsTable.id, contentObjectId),
      limit: 1,
    })) as ContentObject[];
    const row = rows[0];
    return !!row && row.submittedBy === userId;
  });
}

/** System-level read against user_profiles (not brand-scoped). */
export async function callerHasBrandAccess(brandId: string, userId: string): Promise<boolean> {
  const { db } = await import("@workspace/db");
  const result = await db.execute(
    sql`select 1 from public.user_profiles
        where user_id = ${userId}::uuid
          and (${brandId}::uuid = any(brand_access) or role = 'admin')
        limit 1`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return Array.isArray(rows) && rows.length > 0;
}

// keep `and` referenced (used inside scoped.select where clauses elsewhere
// in the service when extending filters)
void and;
