import { eq } from "drizzle-orm";
import {
  withBrandScope,
  attachKeywordToContent,
  projectsTable,
  rankSnapshotsTable,
  crawlBatchesTable,
  eventsTable,
  type Project,
} from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { enqueue } from "@workspace/jobs";
import type { Logger } from "pino";

const KEYWORD_LINKED_EVENT = "content.keyword_linked";

/**
 * `content.publish-link-keyword`
 *
 * Fires when a project transitions `published_at` null -> non-null
 * (enqueued from the projects PATCH route). Auto-links the project's
 * primary keyword (`projects.keyword`, which doubles as the SEO target)
 * to the project via `content_url_keyword_link`, then baselines
 * rankings for the keyword if no rank snapshot exists yet.
 *
 * Graceful degradation (Rule 1): a project with no target keyword is a
 * clean no-op, not an error. `attachKeywordToContent` is idempotent on
 * the link's unique (project_id, keyword_id), so re-running is safe.
 */
export async function handlePublishLinkKeyword(
  payload: JobData<"content.publish-link-keyword">,
  log: Logger,
): Promise<
  | { skipped: true; reason: string }
  | {
      linked: true;
      keywordId: string;
      linkId: string;
      crawlEnqueued: boolean;
    }
> {
  const { brandId, projectId } = payload;

  // 1. Read the project (its own brand scope; attach opens a fresh scope).
  const project = await withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(projectsTable, {
      where: eq(projectsTable.id, projectId),
      limit: 1,
    })) as Project[];
    return rows[0];
  });

  if (!project) {
    log.warn({ projectId }, "publish-link-keyword: project not found — no-op");
    return { skipped: true, reason: "project_not_found" };
  }

  // Rule 1: a project without a target keyword is a clean no-op.
  if (!project.keyword) {
    log.info(
      { projectId },
      "publish-link-keyword: project has no target keyword — no-op",
    );
    return { skipped: true, reason: "no_target_keyword" };
  }

  // 2. Link the keyword to the content (idempotent; may create the keyword,
  //    increment linked_content_count, and write provenance internally).
  const { keywordId, linkId } = await attachKeywordToContent(
    brandId,
    projectId,
    project.keyword,
    project.targetLocationId ?? null,
    "auto",
    true,
  );

  // 3. Baseline rankings for a not-yet-crawled keyword, and emit the
  //    activity-feed event. Telemetry is written through raw `db.insert`, but
  //    this brand event must carry the project's brand; crawl batches remain
  //    brand-scoped (`scoped.insert`).
  const { batchId } = await withBrandScope(brandId, async ({ scoped, db }) => {
    const existingSnaps = (await scoped.select(rankSnapshotsTable, {
      where: eq(rankSnapshotsTable.keywordId, keywordId),
      limit: 1,
    })) as Array<{ id: string }>;

    let createdBatchId: string | null = null;
    if (existingSnaps.length === 0) {
      const inserted = (await scoped.insert(
        crawlBatchesTable,
        { status: "pending", keywordCount: 1 },
        { returning: true },
      )) as Array<{ id: string }>;
      createdBatchId = inserted[0]?.id ?? null;
    }

    await db.insert(eventsTable).values({
      brandId,
      eventType: KEYWORD_LINKED_EVENT,
      subjectType: "content_url_keyword_link",
      subjectId: linkId,
      payload: { projectId, keywordId, baselineCrawl: createdBatchId != null },
    });

    return { batchId: createdBatchId };
  });

  if (batchId) {
    await enqueue("seo.crawl.run", {
      brandId,
      batchId,
      keywordIds: [keywordId],
      idempotencyKey: `seo-crawl:${batchId}`,
    });
  }

  log.info(
    { projectId, keywordId, linkId, crawlEnqueued: batchId != null },
    "publish-link-keyword: linked keyword to published content",
  );
  return { linked: true, keywordId, linkId, crawlEnqueued: batchId != null };
}
