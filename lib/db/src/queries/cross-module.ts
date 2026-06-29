import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withBrandScope } from "../brand-scope";
import {
  keywordsTable,
  locationsTable,
  rankSnapshotsTable,
  competitorPagesTable,
  projectsTable,
  contentUrlKeywordLinkTable,
  moduleDataProvenanceTable,
  type Keyword,
  type RankSnapshot,
  type CompetitorPage,
  type Project,
  type ContentUrlKeywordLink,
} from "../schema";
import {
  STALE_THRESHOLD_DAYS,
  isFreshWithin,
  type DataSource,
  type QueryReason,
  type QueryResult,
} from "./types";

/**
 * Cross-module query helpers. Every read returns the standard
 * `QueryResult<T>` shape and NEVER throws to the caller (DB/system errors
 * are caught and surfaced as `reason: 'system-error'`). All access goes
 * through `withBrandScope`, so a keyword/link belonging to another brand is
 * simply invisible — cross-brand isolation is structural, not conditional.
 *
 * Adjustment vs. the original dispatch: this platform links keywords to
 * `projects` (the article entity), not a separate `drafts` row, so what the
 * dispatch calls `draftId` is a `projectId` here, and the article's primary
 * keyword + published URL live on `projects` (`keyword`, `published_url`).
 */

/* -------------------------------------------------------------------------- */
/* getKeywordContext — ContentForge Intake reads SEO OS                        */
/* -------------------------------------------------------------------------- */

export type KeywordContext = {
  volume: number | null;
  cpc: number | null;
  competition: number | null;
  currentRanking: number | null;
  currentUrl: string | null;
  topCompetitors: Array<{ domain: string; position: number; url: string }>;
};

const EMPTY_KEYWORD_CONTEXT: KeywordContext = {
  volume: null,
  cpc: null,
  competition: null,
  currentRanking: null,
  currentUrl: null,
  topCompetitors: [],
};

export async function getKeywordContext(
  brandId: string,
  keywordText: string,
  locationId?: string,
): Promise<QueryResult<KeywordContext>> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const kwRows = (await scoped.select(keywordsTable, {
        where: locationId
          ? and(
              eq(keywordsTable.keywordText, keywordText),
              eq(keywordsTable.locationId, locationId),
            )!
          : eq(keywordsTable.keywordText, keywordText),
        orderBy: desc(keywordsTable.lastCheckedAt),
        limit: 1,
      })) as Keyword[];
      const kw = kwRows[0];

      if (!kw) {
        return {
          data: EMPTY_KEYWORD_CONTEXT,
          source: null,
          reason: "not-yet-tracked" as const,
        };
      }

      const snapRows = (await scoped.select(rankSnapshotsTable, {
        where: and(
          eq(rankSnapshotsTable.keywordId, kw.id),
          eq(rankSnapshotsTable.locationId, kw.locationId),
        )!,
        orderBy: desc(rankSnapshotsTable.capturedAt),
        limit: 1,
      })) as RankSnapshot[];
      const snap = snapRows[0];

      const compRows = (await scoped.select(competitorPagesTable, {
        where: eq(competitorPagesTable.keywordId, kw.id),
        orderBy: [competitorPagesTable.position, desc(competitorPagesTable.capturedAt)],
        limit: 25,
      })) as CompetitorPage[];

      const now = new Date();
      const metricsAt = kw.lastCheckedAt ?? null;
      const rankAt = snap?.capturedAt ?? null;
      const hasMetrics =
        kw.searchVolume != null ||
        kw.cpc != null ||
        kw.competition != null ||
        metricsAt != null;
      const hasRank = !!snap;

      // Determine freshness across every present category; the source tag
      // reflects the OLDEST (limiting) datum so the UI is conservative.
      let isFresh = true;
      let limitingAt: Date | null = null;
      let limitingThreshold: number = STALE_THRESHOLD_DAYS.keywordMetrics;
      const consider = (at: Date | null, threshold: number) => {
        if (!at) return;
        if (!isFreshWithin(at, threshold, now)) isFresh = false;
        if (!limitingAt || new Date(at).getTime() < new Date(limitingAt).getTime()) {
          limitingAt = at;
          limitingThreshold = threshold;
        }
      };
      consider(metricsAt, STALE_THRESHOLD_DAYS.keywordMetrics);
      consider(rankAt, STALE_THRESHOLD_DAYS.rankSnapshot);

      let reason: QueryReason = null;
      if (!hasMetrics && !hasRank) reason = "never-crawled";
      else if (!hasRank) reason = "no-rankings";
      else if (!isFresh) reason = "stale";

      const source: DataSource | null = limitingAt
        ? {
            module: "seo-os",
            generatedAt: limitingAt,
            isFresh,
            staleAfterDays: limitingThreshold,
            refreshAction: "crawl",
          }
        : null;

      const data: KeywordContext = {
        volume: kw.searchVolume ?? null,
        cpc: kw.cpc != null ? Number(kw.cpc) : null,
        competition: kw.competition != null ? Number(kw.competition) : null,
        currentRanking: snap?.position ?? null,
        currentUrl: snap?.url ?? null,
        topCompetitors: compRows
          .filter((c) => c.position != null)
          .slice(0, 10)
          .map((c) => ({
            domain: c.competitorDomain,
            position: c.position as number,
            url: c.url,
          })),
      };

      return { data, source, reason };
    });
  } catch {
    return {
      data: EMPTY_KEYWORD_CONTEXT,
      source: null,
      reason: "system-error",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* getContentForKeyword — SEO OS Keywords popover reads ContentForge           */
/* -------------------------------------------------------------------------- */

export type LinkedContent = {
  projectId: string;
  title: string;
  status: string;
  publishedUrl: string | null;
  attachedAt: Date;
  isCanonical: boolean;
};

export async function getContentForKeyword(
  brandId: string,
  keywordId: string,
): Promise<QueryResult<LinkedContent[]>> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const links = (await scoped.select(contentUrlKeywordLinkTable, {
        where: eq(contentUrlKeywordLinkTable.keywordId, keywordId),
        orderBy: [
          desc(contentUrlKeywordLinkTable.isCanonical),
          desc(contentUrlKeywordLinkTable.attachedAt),
        ],
      })) as ContentUrlKeywordLink[];

      if (links.length === 0) {
        return { data: [], source: null, reason: "not-published" as const };
      }

      const projectIds = Array.from(new Set(links.map((l) => l.projectId)));
      const projects = (await scoped.select(projectsTable, {
        where: inArray(projectsTable.id, projectIds),
      })) as Project[];
      const byId = new Map(projects.map((p) => [p.id, p]));

      const data: LinkedContent[] = links.map((l) => {
        const p = byId.get(l.projectId);
        return {
          projectId: l.projectId,
          title: p?.topic ?? "(untitled)",
          status: p?.status ?? "unknown",
          publishedUrl: p?.publishedUrl ?? null,
          attachedAt: l.attachedAt,
          isCanonical: l.isCanonical,
        };
      });

      const source: DataSource = {
        module: "content-forge",
        generatedAt: links[0]!.attachedAt,
        isFresh: true,
        staleAfterDays: 3650,
        refreshAction: null,
      };

      return { data, source, reason: null };
    });
  } catch {
    return { data: [], source: null, reason: "system-error" };
  }
}

/* -------------------------------------------------------------------------- */
/* getKeywordsForContent — ContentForge Draft badge reads SEO OS               */
/* -------------------------------------------------------------------------- */

export type LinkedKeyword = {
  keywordId: string;
  keywordText: string;
  currentRanking: number | null;
  volume: number | null;
  isCanonical: boolean;
};

export async function getKeywordsForContent(
  brandId: string,
  projectId: string,
): Promise<QueryResult<LinkedKeyword[]>> {
  try {
    return await withBrandScope(brandId, async ({ scoped }) => {
      const links = (await scoped.select(contentUrlKeywordLinkTable, {
        where: eq(contentUrlKeywordLinkTable.projectId, projectId),
        orderBy: desc(contentUrlKeywordLinkTable.isCanonical),
      })) as ContentUrlKeywordLink[];

      if (links.length === 0) {
        return { data: [], source: null, reason: "not-yet-tracked" as const };
      }

      const keywordIds = Array.from(new Set(links.map((l) => l.keywordId)));
      const kws = (await scoped.select(keywordsTable, {
        where: inArray(keywordsTable.id, keywordIds),
      })) as Keyword[];
      const byId = new Map(kws.map((k) => [k.id, k]));

      const now = new Date();
      let isFresh = true;
      let limitingAt: Date | null = null;

      const data: LinkedKeyword[] = [];
      for (const l of links) {
        const k = byId.get(l.keywordId);
        let ranking: number | null = null;
        if (k) {
          const snap = (await scoped.select(rankSnapshotsTable, {
            where: and(
              eq(rankSnapshotsTable.keywordId, k.id),
              eq(rankSnapshotsTable.locationId, k.locationId),
            )!,
            orderBy: desc(rankSnapshotsTable.capturedAt),
            limit: 1,
          })) as RankSnapshot[];
          ranking = snap[0]?.position ?? null;
          const at = snap[0]?.capturedAt ?? null;
          if (at) {
            if (!isFreshWithin(at, STALE_THRESHOLD_DAYS.rankSnapshot, now)) {
              isFresh = false;
            }
            if (!limitingAt || new Date(at).getTime() < new Date(limitingAt).getTime()) {
              limitingAt = at;
            }
          }
        }
        data.push({
          keywordId: l.keywordId,
          keywordText: k?.keywordText ?? "(unknown)",
          currentRanking: ranking,
          volume: k?.searchVolume ?? null,
          isCanonical: l.isCanonical,
        });
      }

      const source: DataSource | null = limitingAt
        ? {
            module: "seo-os",
            generatedAt: limitingAt,
            isFresh,
            staleAfterDays: STALE_THRESHOLD_DAYS.rankSnapshot,
            refreshAction: "crawl",
          }
        : null;

      const reason: QueryReason = !limitingAt
        ? "no-rankings"
        : !isFresh
          ? "stale"
          : null;

      return { data, source, reason };
    });
  } catch {
    return { data: [], source: null, reason: "system-error" };
  }
}

/* -------------------------------------------------------------------------- */
/* attachKeywordToContent — write helper (publish worker + manual override)     */
/* -------------------------------------------------------------------------- */

/**
 * Link a keyword to a project (article), creating the keyword row if needed.
 * Unlike the read helpers, this is a write and MAY throw on genuinely
 * invalid input (e.g. a brand-new keyword with no location to track it in).
 *
 * Idempotent on (project_id, keyword_id): a repeat call updates the existing
 * link (attribution/canonical flag) WITHOUT double-incrementing the
 * denormalized `keywords.linked_content_count` counter.
 */
export async function attachKeywordToContent(
  brandId: string,
  projectId: string,
  keywordText: string,
  locationId: string | null,
  attachedBy: "auto" | string,
  isCanonical: boolean,
  demoteExistingCanonical = false,
): Promise<{ keywordId: string; linkId: string }> {
  return withBrandScope(brandId, async ({ scoped }) => {
    // 0. Tenant isolation: the project (and location, if given) must belong to
    // this brand. `scoped.*` filters by brand_id, so a foreign id simply isn't
    // found — reject rather than create a cross-tenant reference. (The FKs are
    // by raw UUID, so the DB alone would happily link across brands.)
    const ownedProject = (await scoped.select(projectsTable, {
      where: eq(projectsTable.id, projectId),
      limit: 1,
    })) as { id: string }[];
    if (!ownedProject[0]) {
      throw new Error(`cross-module: project ${projectId} not found in this brand`);
    }
    if (locationId) {
      const ownedLocation = (await scoped.select(locationsTable, {
        where: eq(locationsTable.id, locationId),
        limit: 1,
      })) as { id: string }[];
      if (!ownedLocation[0]) {
        throw new Error(`cross-module: location ${locationId} not found in this brand`);
      }
    }

    // 0b. Atomic canonical override: demote any current canonical link(s) on
    // this project in the SAME transaction as the (re)attach, so the project is
    // never left without a canonical link if a later step fails.
    if (demoteExistingCanonical && isCanonical) {
      const current = (await scoped.select(contentUrlKeywordLinkTable, {
        where: and(
          eq(contentUrlKeywordLinkTable.projectId, projectId),
          eq(contentUrlKeywordLinkTable.isCanonical, true),
        )!,
      })) as ContentUrlKeywordLink[];
      for (const link of current) {
        await scoped.update(
          contentUrlKeywordLinkTable,
          { isCanonical: false },
          eq(contentUrlKeywordLinkTable.id, link.id),
        );
      }
    }

    // 1. Find (or create) the keyword.
    let kw: Keyword | undefined;
    if (locationId) {
      const rows = (await scoped.select(keywordsTable, {
        where: and(
          eq(keywordsTable.keywordText, keywordText),
          eq(keywordsTable.locationId, locationId),
        )!,
        limit: 1,
      })) as Keyword[];
      kw = rows[0];
    } else {
      const rows = (await scoped.select(keywordsTable, {
        where: eq(keywordsTable.keywordText, keywordText),
        orderBy: desc(keywordsTable.createdAt),
        limit: 1,
      })) as Keyword[];
      kw = rows[0];
    }

    if (!kw) {
      if (!locationId) {
        throw new Error(
          `attachKeywordToContent: keyword "${keywordText}" does not exist and ` +
            `cannot be created without a locationId (keywords.location_id is NOT NULL).`,
        );
      }
      const created = (await scoped.insert(
        keywordsTable,
        { keywordText, locationId },
        { returning: true },
      )) as Keyword[];
      kw = created[0]!;
      // Provenance for the auto-created keyword.
      await scoped.insert(moduleDataProvenanceTable, {
        entityType: "keyword",
        entityId: kw.id,
        sourceModule: "content-forge",
        sourceUserId: attachedBy === "auto" ? null : attachedBy,
        generationMethod: attachedBy === "auto" ? "auto-link" : "manual",
        metadata: { keywordText, locationId },
      });
    }

    const keywordId = kw.id;

    // 2. Create or update the link (idempotent on the unique constraint).
    const existing = (await scoped.select(contentUrlKeywordLinkTable, {
      where: and(
        eq(contentUrlKeywordLinkTable.projectId, projectId),
        eq(contentUrlKeywordLinkTable.keywordId, keywordId),
      )!,
      limit: 1,
    })) as ContentUrlKeywordLink[];

    let linkId: string;
    if (existing[0]) {
      linkId = existing[0].id;
      await scoped.update(
        contentUrlKeywordLinkTable,
        { attachedBy, isCanonical, attachedAt: new Date() },
        eq(contentUrlKeywordLinkTable.id, linkId),
      );
    } else {
      const inserted = (await scoped.insert(
        contentUrlKeywordLinkTable,
        { projectId, keywordId, attachedBy, isCanonical },
        { returning: true },
      )) as ContentUrlKeywordLink[];
      linkId = inserted[0]!.id;
      // 3. Increment the denormalized counter — ONLY on a new link.
      await scoped.update(
        keywordsTable,
        { linkedContentCount: sql`${keywordsTable.linkedContentCount} + 1` },
        eq(keywordsTable.id, keywordId),
      );
    }

    // 4. Provenance for the link itself.
    await scoped.insert(moduleDataProvenanceTable, {
      entityType: "content_url_keyword_link",
      entityId: linkId,
      sourceModule: "content-forge",
      sourceUserId: attachedBy === "auto" ? null : attachedBy,
      generationMethod: attachedBy === "auto" ? "auto-link" : "manual",
      metadata: { projectId, keywordId, isCanonical },
    });

    return { keywordId, linkId };
  });
}

/* -------------------------------------------------------------------------- */
/* reconcileLinkedContentCounts — drift guard for the denormalized counter      */
/* -------------------------------------------------------------------------- */

/**
 * Recompute `keywords.linked_content_count` from the authoritative
 * `content_url_keyword_link` rows for a brand. The counter is incremented on
 * every new link but there is NO unlink path in-app; the only way it can drift
 * is an out-of-band delete (e.g. a `projects` hard-delete cascading link rows
 * without touching the counter). Run this periodically (nightly) so the
 * denormalized value can never silently diverge from reality.
 *
 * Returns the number of keyword rows whose count was corrected.
 */
export async function reconcileLinkedContentCounts(brandId: string): Promise<number> {
  return withBrandScope(brandId, async ({ db }) => {
    const result = await db.execute(sql`
      WITH actual AS (
        SELECT k.id AS keyword_id, COUNT(l.id)::int AS real_count
        FROM keywords k
        LEFT JOIN content_url_keyword_link l ON l.keyword_id = k.id
        WHERE k.brand_id = ${brandId}
        GROUP BY k.id
      )
      UPDATE keywords k
      SET linked_content_count = actual.real_count
      FROM actual
      WHERE k.id = actual.keyword_id
        AND k.linked_content_count IS DISTINCT FROM actual.real_count
      RETURNING k.id
    `);
    return result.rowCount ?? 0;
  });
}
