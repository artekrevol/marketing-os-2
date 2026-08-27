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
  brandsTable,
  ahrefsMcpUsageTable,
  USER_ROLES,
  USER_DEPARTMENTS,
  type UserDepartment,
} from "@workspace/db";
import { requireAdmin, assertBrandAccess, BrandAccessError } from "../middlewares/auth.js";
import { eq, desc, gte, sql, and, count, sum, inArray, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

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
        department: p.department,
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

/**
 * POST /api/admin/users — create a new local-auth user.
 *
 * Auth here is bcrypt + session (despite the @clerk/express install), so
 * "create user" means: generate a userId, hash the password, and write a
 * user_profiles row. The new user can log in immediately at /api/auth/login
 * with the email + password the admin supplies. Email is unique-by-policy
 * (login looks up by email) so we reject duplicates explicitly.
 */
router.post("/users", async (req, res, next) => {
  try {
    const body = req.body as {
      email?: unknown;
      password?: unknown;
      role?: unknown;
      department?: unknown;
      pod?: unknown;
      brand_access?: unknown;
      display_name?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? body.role : "member";
    const department = typeof body.department === "string" ? body.department : "writer";
    const pod = typeof body.pod === "string" && body.pod ? body.pod : null;
    const brandAccess = Array.isArray(body.brand_access)
      ? (body.brand_access.filter((x) => typeof x === "string") as string[])
      : [];
    const displayName =
      typeof body.display_name === "string" && body.display_name.trim()
        ? body.display_name.trim()
        : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "valid email required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    const allowedRoles = new Set<string>(USER_ROLES);
    if (!allowedRoles.has(role)) {
      res.status(400).json({ error: "invalid role" });
      return;
    }
    const allowedDepartments = new Set<string>(USER_DEPARTMENTS);
    if (!allowedDepartments.has(department)) {
      res.status(400).json({ error: "invalid department" });
      return;
    }

    const existing = await db
      .select({ userId: userProfilesTable.userId })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.email, email))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "a user with that email already exists" });
      return;
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);

    await db.insert(userProfilesTable).values({
      userId,
      email,
      passwordHash,
      displayName,
      role,
      department: department as UserDepartment,
      pod,
      brandAccess: brandAccess as unknown as string[],
    });

    res.status(201).json({
      user_id: userId,
      email,
      role,
      department,
      pod,
      brand_access: brandAccess,
      display_name: displayName,
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/users/:userId */
router.patch("/users/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role, department, pod, brand_access } = req.body as {
      role?: string;
      department?: string;
      pod?: string | null;
      brand_access?: string[];
    };

    if (role !== undefined && !new Set<string>(USER_ROLES).has(role)) {
      res.status(400).json({ error: "invalid role" });
      return;
    }
    if (department !== undefined && !new Set<string>(USER_DEPARTMENTS).has(department)) {
      res.status(400).json({ error: "invalid department" });
      return;
    }

    await db
      .insert(userProfilesTable)
      .values({
        userId,
        role: role || "member",
        ...(department !== undefined ? { department: department as UserDepartment } : {}),
        pod: pod || null,
        brandAccess: (brand_access as unknown as string[]) || [],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfilesTable.userId,
        set: {
          ...(role !== undefined ? { role } : {}),
          ...(department !== undefined ? { department: department as UserDepartment } : {}),
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
router.get("/playbook", async (req, res, next) => {
  try {
    const brandId = typeof req.query["brandId"] === "string" ? req.query["brandId"] : "";
    if (!brandId) return void res.status(400).json({ error: "brandId is required" });
    const brand = await db.select({ id: brandsTable.id }).from(brandsTable).where(eq(brandsTable.id, brandId)).limit(1);
    if (!brand.length) return void res.status(404).json({ error: "brand not found" });
    const pb = await db
      .select()
      .from(playbookTable)
      .where(eq(playbookTable.brandId, brandId))
      .orderBy(desc(playbookTable.version))
      .limit(1);

    if (pb.length === 0) return void res.json(null);

    const row = pb[0]!;

    const sections = await db
      .select()
      .from(playbookSectionsTable)
      .where(and(eq(playbookSectionsTable.brandId, brandId), eq(playbookSectionsTable.version, row.version)))
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
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : null;
    if (brandId) await assertBrandAccess(req, brandId);
    const since =
      typeof req.query.since === "string"
        ? req.query.since
        : new Date(Date.now() - 24 * 3600_000).toISOString();

    const activityWhere = brandId
      ? and(
          gte(eventsTable.createdAt, new Date(since)),
          eq(eventsTable.brandId, brandId),
          eq(eventsTable.scope, "brand"),
        )
      : gte(eventsTable.createdAt, new Date(since));
    const recent = await db
      .select()
      .from(eventsTable)
      .where(activityWhere)
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
      scope: brandId ? "brand" : "all-brands-and-system",
      brand_id: brandId,
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
    if (err instanceof BrandAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/** GET /api/admin/usage?since=ISO */
router.get("/usage", async (req, res, next) => {
  try {
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : null;
    if (brandId) await assertBrandAccess(req, brandId);
    const since =
      typeof req.query.since === "string"
        ? req.query.since
        : new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const sinceDate = new Date(since);
    const usageSince = brandId
      ? and(gte(usageLogsTable.createdAt, sinceDate), eq(usageLogsTable.brandId, brandId))
      : gte(usageLogsTable.createdAt, sinceDate);

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
        .where(usageSince)
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
        .where(usageSince),

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
            usageSince,
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
      scope: brandId ? "brand" : "all-brands",
      brand_id: brandId,
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
    if (err instanceof BrandAccessError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/**
 * GET /api/admin/ahrefs-usage?brandId=&days=30
 *
 * Operator-facing Ahrefs MCP usage summary. Returns call totals, cache hit
 * rate, estimated units consumed, and per-tool breakdowns.
 * Protected by requireAdmin (applied on this router).
 */
router.get("/ahrefs-usage", async (req, res, next) => {
  try {
    const { brandId, days } = req.query as { brandId?: string; days?: string };
    const periodDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const MONTHLY_BUDGET = 400_000; // Ahrefs plan units/month

    const baseWhere = brandId
      ? and(eq(ahrefsMcpUsageTable.brandId, brandId), gte(ahrefsMcpUsageTable.calledAt, since))
      : gte(ahrefsMcpUsageTable.calledAt, since);

    const [totalsRows, byToolRows, recentErrorRows] = await Promise.all([
      // Aggregate totals
      db
        .select({
          totalCalls: count(),
          cacheHits: sum(sql<number>`CASE WHEN ${ahrefsMcpUsageTable.cacheHit} THEN 1 ELSE 0 END`),
          unitsConsumed: sum(ahrefsMcpUsageTable.unitsConsumed),
        })
        .from(ahrefsMcpUsageTable)
        .where(baseWhere),

      // Per-tool breakdown
      db
        .select({
          toolName: ahrefsMcpUsageTable.toolName,
          calls: count(),
          cacheHits: sum(sql<number>`CASE WHEN ${ahrefsMcpUsageTable.cacheHit} THEN 1 ELSE 0 END`),
        })
        .from(ahrefsMcpUsageTable)
        .where(baseWhere)
        .groupBy(ahrefsMcpUsageTable.toolName)
        .orderBy(desc(count())),

      // Recent errors (last 10)
      db
        .select({
          toolName: ahrefsMcpUsageTable.toolName,
          errorMessage: ahrefsMcpUsageTable.errorMessage,
          calledAt: ahrefsMcpUsageTable.calledAt,
        })
        .from(ahrefsMcpUsageTable)
        .where(
          brandId
            ? and(
                eq(ahrefsMcpUsageTable.brandId, brandId),
                gte(ahrefsMcpUsageTable.calledAt, since),
                eq(ahrefsMcpUsageTable.responseStatus, "error"),
              )
            : and(
                gte(ahrefsMcpUsageTable.calledAt, since),
                eq(ahrefsMcpUsageTable.responseStatus, "error"),
              ),
        )
        .orderBy(desc(ahrefsMcpUsageTable.calledAt))
        .limit(10),
    ]);

    const t = totalsRows[0] ?? { totalCalls: 0, cacheHits: 0, unitsConsumed: 0 };
    const totalCalls = Number(t.totalCalls) || 0;
    const cacheHits = Number(t.cacheHits) || 0;
    const mcpCalls = totalCalls - cacheHits;
    const estimatedUnitsConsumed = Number(t.unitsConsumed) || 0;

    // Approximate remaining monthly budget (resets 2026-08-19, ~400k/mo)
    const USED_BEFORE_INTEGRATION = 11_413; // units used before integration (from dispatch)
    const totalUnitsInMonth = USED_BEFORE_INTEGRATION + estimatedUnitsConsumed;

    res.json({
      scope: brandId ? "brand" : "all-brands",
      brand_id: brandId ?? null,
      period_start: since.toISOString().slice(0, 10),
      period_end: new Date().toISOString().slice(0, 10),
      total_calls: totalCalls,
      cache_hits: cacheHits,
      cache_hit_rate: totalCalls > 0 ? Number((cacheHits / totalCalls).toFixed(4)) : 0,
      mcp_calls: mcpCalls,
      estimated_units_consumed: estimatedUnitsConsumed,
      monthly_budget: MONTHLY_BUDGET,
      budget_used_pct: Number((totalUnitsInMonth / MONTHLY_BUDGET).toFixed(4)),
      top_tools: byToolRows.map((r) => {
        const calls = Number(r.calls) || 0;
        const hits = Number(r.cacheHits) || 0;
        return {
          tool: r.toolName,
          calls,
          cache_hit_rate: calls > 0 ? Number((hits / calls).toFixed(4)) : 0,
        };
      }),
      recent_errors: recentErrorRows.map((r) => ({
        tool: r.toolName,
        error: r.errorMessage ?? "",
        at: r.calledAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
