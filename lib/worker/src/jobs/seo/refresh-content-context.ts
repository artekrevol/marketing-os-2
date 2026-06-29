import { eq, lt } from "drizzle-orm";
import {
  withBrandScope,
  guardedDb,
  getKeywordContext,
  reconcileLinkedContentCounts,
  brandsTable,
  projectsTable,
  keywordResearchBriefsTable,
  moduleDataProvenanceTable,
  eventsTable,
  type KeywordContext,
  type KeywordResearchBrief,
  type Project,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { enqueue } from "@workspace/jobs";
import type { Logger } from "pino";

const CONTEXT_CHANGED_EVENT = "seo.context_changed";
const STALE_BRIEF_DAYS = 7;
const VOLUME_CHANGE_THRESHOLD = 0.2;
const RANKING_CHANGE_THRESHOLD = 5;
const TOP_COMPETITOR_DEPTH = 5;

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Decide whether the SEO context shifted enough to warrant a writer
 * notification: volume moved >20%, ranking moved >5 positions, a new
 * domain entered the top 5 competitors, or data appeared where there
 * was none. A null previous snapshot (first refresh) counts as changed.
 */
function contextChangedMeaningfully(
  prev: KeywordContext | null,
  next: KeywordContext,
): boolean {
  if (!prev) return true;

  if (prev.volume == null && next.volume != null) return true;
  if (
    prev.volume != null &&
    next.volume != null &&
    prev.volume > 0 &&
    Math.abs(next.volume - prev.volume) / prev.volume > VOLUME_CHANGE_THRESHOLD
  ) {
    return true;
  }

  if (prev.currentRanking == null && next.currentRanking != null) return true;
  if (
    prev.currentRanking != null &&
    next.currentRanking != null &&
    Math.abs(next.currentRanking - prev.currentRanking) >
      RANKING_CHANGE_THRESHOLD
  ) {
    return true;
  }

  const prevTop = new Set(
    (prev.topCompetitors ?? [])
      .slice(0, TOP_COMPETITOR_DEPTH)
      .map((c) => c.domain),
  );
  for (const c of (next.topCompetitors ?? []).slice(0, TOP_COMPETITOR_DEPTH)) {
    if (!prevTop.has(c.domain)) return true;
  }

  return false;
}

/**
 * `seo.refresh-content-context` (per-brief)
 *
 * Re-runs `getKeywordContext` for an in-flight brief and writes a NEW
 * `keyword_research_briefs` snapshot row — the table is immutable in
 * practice, so the refresh worker never updates an existing row in
 * place (preserves history; UI reads the latest). Emits a writer
 * notification only when the context changed meaningfully.
 */
export async function handleSeoRefreshContentContext(
  payload: JobData<"seo.refresh-content-context">,
  log: Logger,
): Promise<
  | { skipped: true; reason: string }
  | { refreshed: true; newBriefId: string; changed: boolean }
> {
  const { brandId, briefId } = payload;

  const brief = await withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(keywordResearchBriefsTable, {
      where: eq(keywordResearchBriefsTable.id, briefId),
      limit: 1,
    })) as KeywordResearchBrief[];
    return rows[0];
  });

  if (!brief) {
    log.warn({ briefId }, "refresh-content-context: brief not found — no-op");
    return { skipped: true, reason: "brief_not_found" };
  }

  // Re-run the cross-module read. getKeywordContext never throws.
  const result = await getKeywordContext(
    brandId,
    brief.keywordText,
    brief.locationId ?? undefined,
  );
  const nextContext = result.data;

  const prevSnapshot = brief.contextSnapshot as
    | { context?: KeywordContext | null }
    | null
    | undefined;
  const prevContext = prevSnapshot?.context ?? null;

  const changed = contextChangedMeaningfully(prevContext, nextContext);

  // Write a NEW immutable snapshot row tied to the same project.
  const newBriefId = await withBrandScope(brandId, async ({ scoped, db }) => {
    const inserted = (await scoped.insert(
      keywordResearchBriefsTable,
      {
        projectId: brief.projectId,
        keywordText: brief.keywordText,
        locationId: brief.locationId,
        requestedBy: brief.requestedBy,
        contextSnapshot: {
          context: nextContext,
          source: result.source,
          reason: result.reason,
          refreshedAt: new Date().toISOString(),
          refreshedFromBriefId: brief.id,
        },
      },
      { returning: true },
    )) as Array<{ id: string }>;
    const createdId = inserted[0]!.id;

    // Provenance for the refreshed snapshot.
    await scoped.insert(moduleDataProvenanceTable, {
      entityType: "keyword_research_briefs",
      entityId: createdId,
      sourceModule: "seo-os",
      generationMethod: "crawl",
      metadata: {
        keywordText: brief.keywordText,
        refreshedFromBriefId: brief.id,
        changed,
      },
    });

    // Notify the writer only on a meaningful change. Events are not
    // brand-scoped — use the raw guarded client.
    if (changed) {
      await db.insert(eventsTable).values({
        brandId,
        eventType: CONTEXT_CHANGED_EVENT,
        subjectType: "project",
        subjectId: brief.projectId,
        payload: {
          briefId: createdId,
          keywordText: brief.keywordText,
          previous: prevContext
            ? {
                volume: prevContext.volume,
                currentRanking: prevContext.currentRanking,
              }
            : null,
          current: {
            volume: nextContext.volume,
            currentRanking: nextContext.currentRanking,
          },
        },
      });
    }

    return createdId;
  });

  log.info(
    { briefId, newBriefId, changed },
    "refresh-content-context: wrote refreshed snapshot",
  );
  return { refreshed: true, newBriefId, changed };
}

/**
 * `seo.refresh-content-context-nightly` (BullMQ repeatable, 0 3 * * *)
 *
 * Fan-out: enumerate brands, and for each, find in-flight briefs
 * (project not yet published) whose latest snapshot is older than 7
 * days. Dedupe by project (keep the most recent brief) and enqueue one
 * `seo.refresh-content-context` per kept brief.
 */
export async function handleSeoRefreshContentContextNightly(
  _payload: JobData<"seo.refresh-content-context-nightly">,
  log: Logger,
): Promise<{ brandsScanned: number; briefsEnqueued: number }> {
  const cutoff = new Date(Date.now() - STALE_BRIEF_DAYS * 24 * 60 * 60 * 1000);
  const today = isoDateUtc(new Date());

  const brands = (await guardedDb
    .select({ id: brandsTable.id })
    .from(brandsTable)) as Array<{ id: string }>;

  let briefsEnqueued = 0;

  for (const { id: brandId } of brands) {
    const toRefresh = await withBrandScope(brandId, async ({ scoped }) => {
      const briefs = (await scoped.select(keywordResearchBriefsTable, {
        where: lt(keywordResearchBriefsTable.requestedAt, cutoff),
      })) as KeywordResearchBrief[];

      // Dedupe by project, keeping the most recent brief per project.
      const latestByProject = new Map<string, KeywordResearchBrief>();
      for (const b of briefs) {
        if (!b.projectId) continue; // in-flight requires a project
        const existing = latestByProject.get(b.projectId);
        if (
          !existing ||
          b.requestedAt.getTime() > existing.requestedAt.getTime()
        ) {
          latestByProject.set(b.projectId, b);
        }
      }
      if (latestByProject.size === 0) return [] as KeywordResearchBrief[];

      // Drop briefs whose project is already published (not in-flight).
      const projectIds = [...latestByProject.keys()];
      const kept: KeywordResearchBrief[] = [];
      for (const projectId of projectIds) {
        const rows = (await scoped.select(projectsTable, {
          where: eq(projectsTable.id, projectId),
          limit: 1,
        })) as Project[];
        const project = rows[0];
        if (!project) continue;
        if (project.publishedAt != null) continue; // already live
        kept.push(latestByProject.get(projectId)!);
      }
      return kept;
    });

    for (const brief of toRefresh) {
      await enqueue("seo.refresh-content-context", {
        brandId,
        briefId: brief.id,
        idempotencyKey: `refresh-context:${brief.id}-${today}`,
      });
      briefsEnqueued += 1;
    }

    // Drift guard: the denormalized `keywords.linked_content_count` is only
    // ever incremented (no in-app unlink), so an out-of-band delete (e.g. a
    // project hard-delete cascading its link rows) leaves it overcounting.
    // Recompute it from the authoritative link rows nightly. Never let a
    // reconciliation failure abort the rest of the fan-out.
    try {
      const corrected = await reconcileLinkedContentCounts(brandId);
      if (corrected > 0) {
        log.info(
          { brandId, corrected },
          "refresh-content-context-nightly: reconciled linked_content_count drift",
        );
      }
    } catch (err) {
      log.error(
        { err, brandId },
        "refresh-content-context-nightly: linked_content_count reconciliation failed",
      );
    }
  }

  log.info(
    { brandsScanned: brands.length, briefsEnqueued },
    "refresh-content-context-nightly: fan-out complete",
  );
  return { brandsScanned: brands.length, briefsEnqueued };
}
