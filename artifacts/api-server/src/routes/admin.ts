import { Router } from "express";
import {
  db,
  userProfilesTable,
  projectsTable,
  draftsTable,
  proofPointsTable,
  draftScoresTable,
  voiceLibraryTable,
  eventsTable,
  usageLogsTable,
  playbookTable,
  playbookSectionsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth.js";
import { eq, desc, gte, sql, and, count, sum, inArray, asc } from "drizzle-orm";

const router = Router();

router.use(requireAdmin);

/** GET /api/admin/users */
router.get("/users", async (_req, res, next) => {
  try {
    const profiles = await db
      .select()
      .from(userProfilesTable)
      .orderBy(desc(userProfilesTable.createdAt));

    const projectCounts = await db
      .select({ writerId: projectsTable.writerId, cnt: count() })
      .from(projectsTable)
      .groupBy(projectsTable.writerId);

    const countMap: Record<string, number> = {};
    for (const r of projectCounts) {
      if (r.writerId) countMap[r.writerId] = Number(r.cnt);
    }

    res.json(
      profiles.map((p) => ({
        user_id: p.userId,
        email: p.email,
        role: p.role,
        pod: p.pod,
        brand_access: p.brandAccess || [],
        project_count: countMap[p.userId] ?? 0,
        is_admin: p.role === "admin",
        is_tekrevol: p.email?.endsWith("@tekrevol.com") ?? false,
        last_sign_in: null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:userId */
router.patch("/users/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role, pod, brand_access } = req.body as {
      role?: string;
      pod?: string | null;
      brand_access?: string[];
    };

    await db
      .insert(userProfilesTable)
      .values({
        userId,
        role: role || "writer",
        pod: pod || null,
        brandAccess: (brand_access as unknown as string[]) || [],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfilesTable.userId,
        set: {
          ...(role !== undefined ? { role } : {}),
          ...(pod !== undefined ? { pod } : {}),
          ...(brand_access !== undefined ? { brandAccess: brand_access as unknown as string[] } : {}),
          updatedAt: new Date(),
        },
      });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/dashboard */
router.get("/dashboard", async (_req, res, next) => {
  try {
    const [projects, voiceRows] = await Promise.all([
      db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt)),
      db
        .select()
        .from(voiceLibraryTable)
        .orderBy(desc(voiceLibraryTable.capturedAt))
        .limit(20),
    ]);

    const ids = projects.map((p) => p.id);

    const voiceMapped = voiceRows.map((v) => ({
      id: v.id,
      project_id: v.projectId,
      brand_id: v.brandId,
      writer_id: v.writerId,
      original_ai_text: v.originalAiText,
      edited_human_text: v.editedHumanText,
      edit_type: v.editType,
      captured_at: v.capturedAt,
    }));

    if (ids.length === 0) {
      return void res.json({ rows: [], voice: voiceMapped });
    }

    const [scores, drafts, proofs] = await Promise.all([
      db
        .select()
        .from(draftScoresTable)
        .where(inArray(draftScoresTable.projectId, ids)),
      db
        .select({
          projectId: draftsTable.projectId,
          citationCount: draftsTable.citationCount,
        })
        .from(draftsTable)
        .where(inArray(draftsTable.projectId, ids)),
      db
        .select({ projectId: proofPointsTable.projectId })
        .from(proofPointsTable)
        .where(inArray(proofPointsTable.projectId, ids)),
    ]);

    const enriched = projects.map((p) => {
      const sc = scores.find((s) => s.projectId === p.id);
      const dCount = drafts
        .filter((d) => d.projectId === p.id)
        .reduce((n, d) => n + (d.citationCount || 0), 0);
      const pCount = proofs.filter((pp) => pp.projectId === p.id).length;
      const minutes = Math.round(
        (Date.now() - new Date(p.createdAt).getTime()) / 60000,
      );
      return {
        id: p.id,
        brand_id: p.brandId,
        topic: p.topic,
        content_type: p.contentType,
        mode: p.mode,
        status: p.status,
        current_stage: p.currentStage,
        url: p.url,
        keyword: p.keyword,
        funnel_stage: p.funnelStage,
        pod: p.pod,
        writer_id: p.writerId,
        created_by: p.createdBy,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        citations: dCount,
        proofs: pCount,
        minutes,
        scores: sc
          ? {
              voice_match_score: sc.voiceMatchScore,
              originality_score: sc.originalityScore,
              banned_phrase_count: sc.bannedPhraseCount,
              word_count: sc.wordCount,
              ai_citation_readiness_score: sc.aiCitationReadinessScore,
            }
          : null,
      };
    });

    res.json({ rows: enriched, voice: voiceMapped });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/playbook */
router.get("/playbook", async (_req, res, next) => {
  try {
    const pb = await db
      .select()
      .from(playbookTable)
      .orderBy(desc(playbookTable.version))
      .limit(1);

    if (pb.length === 0) return void res.json(null);

    const row = pb[0]!;

    const sections = await db
      .select()
      .from(playbookSectionsTable)
      .where(eq(playbookSectionsTable.version, row.version))
      .orderBy(asc(playbookSectionsTable.sectionNumber));

    // Serialize to snake_case so the frontend (which predates OpenAPI codegen
    // for this endpoint) can read content_markdown, uploaded_at, etc. directly.
    res.json({
      id: row.id,
      version: row.version,
      content_markdown: row.contentMarkdown,
      source_filename: row.sourceFilename,
      uploaded_by: row.uploadedBy,
      uploaded_at: row.uploadedAt,
      created_at: row.createdAt,
      sections: sections.map((s) => ({
        id: s.id,
        version: s.version,
        section_number: s.sectionNumber,
        section_title: s.sectionTitle,
        section_content: s.sectionContent,
        section_token_estimate: s.sectionTokenEstimate,
        always_include: s.alwaysInclude,
        created_at: s.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/activity?since=ISO */
router.get("/activity", async (req, res, next) => {
  try {
    const since =
      typeof req.query.since === "string"
        ? req.query.since
        : new Date(Date.now() - 24 * 3600_000).toISOString();

    const recent = await db
      .select()
      .from(eventsTable)
      .where(gte(eventsTable.createdAt, new Date(since)))
      .orderBy(desc(eventsTable.createdAt))
      .limit(100);

    const byUser: Record<
      string,
      { user_id: string; user_email: string | null; last_seen: string; visits: number; path: string }
    > = {};
    for (const e of recent) {
      const uid = e.actorId?.toString() || "system";
      if (!byUser[uid]) {
        byUser[uid] = {
          user_id: uid,
          user_email: null,
          last_seen: e.createdAt.toISOString(),
          visits: 0,
          path: (e.payload as Record<string, unknown>)?.path as string || e.eventType,
        };
      }
      byUser[uid].visits++;
      if (e.createdAt > new Date(byUser[uid].last_seen)) {
        byUser[uid].last_seen = e.createdAt.toISOString();
      }
    }

    res.json({
      aggregate: Object.values(byUser).map((u) => ({
        ...u,
        total_seconds: 0,
        avg_seconds: 0,
        max_seconds: 0,
      })),
      recent: recent.map((e) => ({
        id: e.id,
        user_email: null,
        path: (e.payload as Record<string, unknown>)?.path as string || e.eventType,
        duration_ms: (e.payload as Record<string, unknown>)?.duration_ms ?? null,
        entered_at: e.createdAt.toISOString(),
        project_id:
          e.subjectType === "project" ? e.subjectId : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/usage?since=ISO */
router.get("/usage", async (req, res, next) => {
  try {
    const since =
      typeof req.query.since === "string"
        ? req.query.since
        : new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const sinceDate = new Date(since);

    const [byStageRows, totalsRow, byProjectRows] = await Promise.all([
      db
        .select({
          stage: usageLogsTable.stage,
          calls: count(),
          inputTokens: sum(usageLogsTable.inputTokens),
          outputTokens: sum(usageLogsTable.outputTokens),
          cacheRead: sum(usageLogsTable.cacheReadInputTokens),
          cacheCreation: sum(usageLogsTable.cacheCreationInputTokens),
          costUsd: sum(usageLogsTable.estimatedCostUsd),
        })
        .from(usageLogsTable)
        .where(gte(usageLogsTable.createdAt, sinceDate))
        .groupBy(usageLogsTable.stage),

      db
        .select({
          calls: count(),
          inputTokens: sum(usageLogsTable.inputTokens),
          outputTokens: sum(usageLogsTable.outputTokens),
          cacheCreation: sum(usageLogsTable.cacheCreationInputTokens),
          cacheRead: sum(usageLogsTable.cacheReadInputTokens),
          costUsd: sum(usageLogsTable.estimatedCostUsd),
          errors: sql<number>`SUM(CASE WHEN ok = false THEN 1 ELSE 0 END)`,
        })
        .from(usageLogsTable)
        .where(gte(usageLogsTable.createdAt, sinceDate)),

      db
        .select({
          projectId: usageLogsTable.projectId,
          calls: count(),
          costUsd: sum(usageLogsTable.estimatedCostUsd),
          totalTokens: sql<number>`SUM(input_tokens + output_tokens)`,
        })
        .from(usageLogsTable)
        .where(
          and(
            gte(usageLogsTable.createdAt, sinceDate),
            sql`project_id IS NOT NULL`,
          ),
        )
        .groupBy(usageLogsTable.projectId)
        .orderBy(desc(sum(usageLogsTable.estimatedCostUsd)))
        .limit(20),
    ]);

    const t = totalsRow[0] || {};
    const totalCalls = Number(t.calls) || 0;
    const totalCacheRead = Number(t.cacheRead) || 0;
    const totalInput = Number(t.inputTokens) || 0;

    res.json({
      since,
      totals: {
        calls: totalCalls,
        input_tokens: totalInput,
        output_tokens: Number(t.outputTokens) || 0,
        cache_creation_tokens: Number(t.cacheCreation) || 0,
        cache_read_tokens: totalCacheRead,
        cost_usd: Number(t.costUsd) || 0,
        cache_hit_rate: totalInput > 0 ? totalCacheRead / totalInput : 0,
        errors: Number(t.errors) || 0,
      },
      by_stage: byStageRows.map((r) => ({
        stage: r.stage || "unknown",
        calls: Number(r.calls),
        input_tokens: Number(r.inputTokens),
        output_tokens: Number(r.outputTokens),
        cache_read_tokens: Number(r.cacheRead),
        cache_creation_tokens: Number(r.cacheCreation),
        cost_usd: Number(r.costUsd),
      })),
      by_project: byProjectRows.map((r) => ({
        project_id: r.projectId,
        topic: null,
        calls: Number(r.calls),
        cost_usd: Number(r.costUsd),
        total_tokens: Number(r.totalTokens),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
