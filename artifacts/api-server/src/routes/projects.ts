import { Router, type NextFunction, type Request, type Response } from "express";
import {
  db,
  projectsTable,
  locationsTable,
  researchBriefsTable,
  proofPointsTable,
  outlinesTable,
  draftsTable,
  draftScoresTable,
  interviewAnswersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { enqueue } from "@workspace/jobs";
import {
  requireAuth,
  assertBrandAccess,
  assertBrandAccessForProject,
  BrandAccessError,
} from "../middlewares/auth.js";

const router = Router();

/**
 * Translate BrandAccessError → HTTP 403/404; forward everything else.
 * Use as the catch-block delegate for every handler in this router.
 */
function handleRouteError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof BrandAccessError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

/**
 * Tenant isolation for the `target_location_id` raw-UUID FK: a location may
 * only be attached to a project if it belongs to the same brand. Throws a
 * BrandAccessError (→ 404) when the location is missing or owned by another
 * brand, so a caller can never bind a foreign location to their project.
 */
async function assertLocationInBrand(locationId: string, brandId: string): Promise<void> {
  const rows = await db
    .select({ id: locationsTable.id })
    .from(locationsTable)
    .where(and(eq(locationsTable.id, locationId), eq(locationsTable.brandId, brandId)))
    .limit(1);
  if (!rows[0]) {
    throw new BrandAccessError(404, "target location not found in this brand");
  }
}

function projectToSnake(p: typeof projectsTable.$inferSelect) {
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
    keyword_cluster: p.keywordCluster,
    funnel_stage: p.funnelStage,
    pod: p.pod,
    company_domain: p.companyDomain,
    competitor_url: p.competitorUrl,
    benchmark_url: p.benchmarkUrl,
    playbook_version: p.playbookVersion,
    ai_proposed_brief: p.aiProposedBrief,
    brief_error: p.briefError,
    user_notes: p.userNotes,
    user_overrides: p.userOverrides,
    icps: p.icps,
    writer_id: p.writerId,
    created_by: p.createdBy,
    target_location_id: p.targetLocationId,
    published_url: p.publishedUrl,
    published_at: p.publishedAt,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/**
 * GET /api/projects?brandId=<uuid>
 * Returns projects for the given brand, newest first, limited to 50.
 */
router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brandId = typeof req.query.brandId === "string" ? req.query.brandId : null;
    if (!brandId) {
      res.status(400).json({ error: "brandId query parameter is required" });
      return;
    }
    await assertBrandAccess(req, brandId);
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.brandId, brandId))
      .orderBy(desc(projectsTable.updatedAt))
      .limit(50);
    res.json(rows.map(projectToSnake));
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * POST /api/projects
 * Creates a new project and returns it.
 */
router.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { topic, url, user_notes, brand_id, keyword, target_location_id } = req.body as {
      topic?: string;
      url?: string;
      user_notes?: string;
      brand_id?: string;
      keyword?: string | null;
      target_location_id?: string | null;
    };
    if (!topic || !brand_id) {
      res.status(400).json({ error: "topic and brand_id are required" });
      return;
    }
    await assertBrandAccess(req, brand_id);
    if (target_location_id) {
      await assertLocationInBrand(target_location_id, brand_id);
    }
    const [project] = await db
      .insert(projectsTable)
      .values({
        topic,
        url: url || null,
        userNotes: user_notes || null,
        keyword: keyword || null,
        targetLocationId: target_location_id || null,
        contentType: null,
        mode: "research",
        status: "proposing_brief",
        currentStage: 0,
        brandId: brand_id,
        createdBy: req.auth?.userId ?? null,
      })
      .returning();
    res.status(201).json({ project: projectToSnake(project!) });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id
 */
router.get("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const requestedBrandId =
      typeof req.query.brandId === "string" ? req.query.brandId : null;
    let brandId: string;
    if (requestedBrandId) {
      await assertBrandAccess(req, requestedBrandId);
      brandId = requestedBrandId;
    } else {
      brandId = await assertBrandAccessForProject(req, id);
    }
    const rows = await db.select().from(projectsTable).where(and(eq(projectsTable.id, id), eq(projectsTable.brandId, brandId))).limit(1);
    const project = rows[0];
    if (!project) { res.status(404).json({ error: "project not found" }); return; }
    res.json(projectToSnake(project));
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * PATCH /api/projects/:id
 */
router.patch("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const body = req.body as Record<string, unknown>;
    const allowed: Partial<typeof projectsTable.$inferInsert> = {};
    if (body["status"] !== undefined) allowed.status = String(body["status"]);
    if (body["current_stage"] !== undefined) allowed.currentStage = Number(body["current_stage"]);
    if (body["keyword"] !== undefined) allowed.keyword = body["keyword"] as string | null;
    if (body["keyword_cluster"] !== undefined) allowed.keywordCluster = body["keyword_cluster"] as never;
    if (body["funnel_stage"] !== undefined) allowed.funnelStage = body["funnel_stage"] as string | null;
    if (body["user_overrides"] !== undefined) allowed.userOverrides = body["user_overrides"] as never;
    if (body["icps"] !== undefined) allowed.icps = body["icps"] as never;
    if (body["company_domain"] !== undefined) allowed.companyDomain = body["company_domain"] as string | null;
    if (body["competitor_url"] !== undefined) allowed.competitorUrl = body["competitor_url"] as string | null;
    if (body["benchmark_url"] !== undefined) allowed.benchmarkUrl = body["benchmark_url"] as string | null;
    if (body["content_type"] !== undefined) allowed.contentType = String(body["content_type"]);
    if (body["mode"] !== undefined && body["mode"] !== null) allowed.mode = body["mode"] as string;
    if (body["pod"] !== undefined) allowed.pod = body["pod"] as string | null;
    if (body["writer_id"] !== undefined) allowed.writerId = body["writer_id"] as string | null;
    if (body["user_notes"] !== undefined) allowed.userNotes = body["user_notes"] as string | null;
    if (body["target_location_id"] !== undefined) allowed.targetLocationId = body["target_location_id"] as string | null;
    if (body["published_url"] !== undefined) allowed.publishedUrl = body["published_url"] as string | null;
    if (body["published_at"] !== undefined) {
      allowed.publishedAt = body["published_at"] ? new Date(body["published_at"] as string) : null;
    }
    if (Object.keys(allowed).length === 0) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }
    // Read the pre-update state so we can detect a publish transition
    // (published_at null -> non-null) and fire the publish-link worker.
    const [before] = await db
      .select({ publishedAt: projectsTable.publishedAt, brandId: projectsTable.brandId })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.brandId, brandId)))
      .limit(1);
    if (!before) { res.status(404).json({ error: "project not found" }); return; }
    // Tenant isolation: a re-targeted location must belong to the project's brand.
    if (allowed.targetLocationId) {
      await assertLocationInBrand(allowed.targetLocationId, before.brandId);
    }
    allowed.updatedAt = new Date();
    const [updated] = await db.update(projectsTable).set(allowed).where(and(eq(projectsTable.id, id), eq(projectsTable.brandId, brandId))).returning();
    if (!updated) { res.status(404).json({ error: "project not found" }); return; }

    // Publish trigger: enqueue the cross-module link job exactly on the
    // null -> non-null transition. Enqueue failures must not fail the PATCH.
    if (before && before.publishedAt == null && updated.publishedAt != null) {
      try {
        await enqueue("content.publish-link-keyword", {
          brandId: updated.brandId,
          projectId: updated.id,
          idempotencyKey: `publish-link:${updated.id}`,
        });
      } catch (enqueueErr) {
        req.log.error({ err: enqueueErr, projectId: updated.id }, "failed to enqueue content.publish-link-keyword");
      }
    }
    res.json(projectToSnake(updated));
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * DELETE /api/projects/:id
 */
router.delete("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const deleted = await db.delete(projectsTable).where(and(eq(projectsTable.id, id), eq(projectsTable.brandId, brandId))).returning({ id: projectsTable.id });
    if (!deleted.length) { res.status(404).json({ error: "project not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id/research
 */
router.get("/:id/research", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const rows = await db.select().from(researchBriefsTable).where(and(eq(researchBriefsTable.projectId, id), eq(researchBriefsTable.brandId, brandId))).limit(1);
    const brief = rows[0];
    if (!brief) { res.json(null); return; }
    res.json({
      id: brief.id,
      project_id: brief.projectId,
      brand_id: brief.brandId,
      search_intent: brief.searchIntent,
      benchmark_teardown: brief.benchmarkTeardown,
      competitor_teardown: brief.competitorTeardown,
      synergy_map: brief.synergyMap,
      angle_inventory: brief.angleInventory,
      conversion_signals: brief.conversionSignals,
      ai_citation_landscape: brief.aiCitationLandscape,
      atomic_question_map: brief.atomicQuestionMap,
      entity_data_requirements: brief.entityDataRequirements,
      proof_points_status: brief.proofPointsStatus,
      approved_at: brief.approvedAt,
      sub_status: brief.subStatus,
      updated_at: brief.updatedAt,
      created_at: brief.createdAt,
    });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * PATCH /api/projects/:id/research/approve
 */
router.patch("/:id/research/approve", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const [updated] = await db
      .update(researchBriefsTable)
      .set({ approvedAt: new Date() })
      .where(and(eq(researchBriefsTable.projectId, id), eq(researchBriefsTable.brandId, brandId)))
      .returning({ approvedAt: researchBriefsTable.approvedAt });
    res.json({ ok: true, approved_at: updated?.approvedAt });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id/proof-points
 */
router.get("/:id/proof-points", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const rows = await db.select().from(proofPointsTable).where(and(eq(proofPointsTable.projectId, id), eq(proofPointsTable.brandId, brandId)));
    res.json(rows.map((p) => ({
      id: p.id,
      project_id: p.projectId,
      brand_id: p.brandId,
      claim: p.claim,
      source_url: p.sourceUrl,
      source_publication: p.sourcePublication,
      publication_date: p.publicationDate,
      verification_status: p.verificationStatus,
      starred: p.starred,
      created_at: p.createdAt,
    })));
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * PATCH /api/projects/:id/proof-points/:ppId
 */
router.patch("/:id/proof-points/:ppId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const { starred } = req.body as { starred?: boolean };
    const update: Partial<typeof proofPointsTable.$inferInsert> = {};
    if (starred !== undefined) update.starred = Boolean(starred);
    if (Object.keys(update).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
    const [updated] = await db
      .update(proofPointsTable)
      .set(update)
      .where(and(eq(proofPointsTable.id, req.params["ppId"] as string), eq(proofPointsTable.projectId, id), eq(proofPointsTable.brandId, brandId)))
      .returning({ id: proofPointsTable.id, starred: proofPointsTable.starred });
    if (!updated) { res.status(404).json({ error: "proof point not found" }); return; }
    res.json(updated);
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id/outlines
 */
router.get("/:id/outlines", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const rows = await db.select().from(outlinesTable).where(and(eq(outlinesTable.projectId, id), eq(outlinesTable.brandId, brandId))).limit(1);
    const o = rows[0];
    if (!o) { res.json(null); return; }
    res.json({
      id: o.id,
      project_id: o.projectId,
      brand_id: o.brandId,
      h1: o.h1,
      meta_description: o.metaDescription,
      sections: o.sections,
      internal_links: o.internalLinks,
      cta_placement: o.ctaPlacement,
      tone_reminder: o.toneReminder,
      locked_at: o.lockedAt,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
    });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * PATCH /api/projects/:id/outlines
 */
router.patch("/:id/outlines", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const body = req.body as Record<string, unknown>;
    const patch: Partial<typeof outlinesTable.$inferInsert> = {};
    if (body["sections"] !== undefined) patch.sections = body["sections"] as never;
    if (body["h1"] !== undefined) patch.h1 = body["h1"] as string | null;
    if (body["meta_description"] !== undefined) patch.metaDescription = body["meta_description"] as string | null;
    if (body["cta_placement"] !== undefined) patch.ctaPlacement = body["cta_placement"] as string | null;
    if (body["tone_reminder"] !== undefined) patch.toneReminder = body["tone_reminder"] as string | null;
    if (body["locked_at"] !== undefined) patch.lockedAt = body["locked_at"] ? new Date(body["locked_at"] as string) : null;
    patch.updatedAt = new Date();
    const [updated] = await db
      .update(outlinesTable)
      .set(patch)
      .where(and(eq(outlinesTable.projectId, id), eq(outlinesTable.brandId, brandId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "outline not found" }); return; }
    res.json({
      id: updated.id,
      project_id: updated.projectId,
      h1: updated.h1,
      meta_description: updated.metaDescription,
      sections: updated.sections,
      internal_links: updated.internalLinks,
      cta_placement: updated.ctaPlacement,
      tone_reminder: updated.toneReminder,
      locked_at: updated.lockedAt,
      updated_at: updated.updatedAt,
    });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id/drafts
 */
router.get("/:id/drafts", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const rows = await db.select().from(draftsTable).where(and(eq(draftsTable.projectId, id), eq(draftsTable.brandId, brandId)));
    res.json(rows.map((d) => ({
      id: d.id,
      project_id: d.projectId,
      section_id: d.sectionId,
      section_heading: d.sectionHeading,
      content: d.content,
      approved: d.approved,
      voice_match_score: d.voiceMatchScore,
      voice_flags: d.voiceFlags,
      dismissed_voice_flags: d.dismissedVoiceFlags,
      review_questions: d.reviewQuestions,
      citation_count: d.citationCount,
      revision_count: d.revisionCount,
      ai_citation_readiness_score: d.aiCitationReadinessScore,
      atomic_chunks_count: d.atomicChunksCount,
      entity_density_score: d.entityDensityScore,
      schema_markup_recommendations: d.schemaMarkupRecommendations,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    })));
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * PATCH /api/projects/:id/drafts/:sectionId
 */
router.patch("/:id/drafts/:sectionId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const body = req.body as Record<string, unknown>;
    const patch: Partial<typeof draftsTable.$inferInsert> = {};
    if (body["approved"] !== undefined) patch.approved = Boolean(body["approved"]);
    if (body["content"] !== undefined) patch.content = body["content"] as string;
    if (body["dismissed_voice_flags"] !== undefined) patch.dismissedVoiceFlags = body["dismissed_voice_flags"] as never;
    patch.updatedAt = new Date();
    const [updated] = await db
      .update(draftsTable)
      .set(patch)
      .where(and(eq(draftsTable.projectId, id), eq(draftsTable.brandId, brandId), eq(draftsTable.sectionId, req.params["sectionId"] as string)))
      .returning({ id: draftsTable.id, approved: draftsTable.approved, sectionId: draftsTable.sectionId });
    if (!updated) { res.status(404).json({ error: "draft not found" }); return; }
    res.json({ id: updated.id, section_id: updated.sectionId, approved: updated.approved });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id/draft-scores
 */
router.get("/:id/draft-scores", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, id);
    const rows = await db.select().from(draftScoresTable).where(and(eq(draftScoresTable.projectId, id), eq(draftScoresTable.brandId, brandId))).limit(1);
    const s = rows[0];
    if (!s) { res.json(null); return; }
    res.json({
      id: s.id,
      project_id: s.projectId,
      final_draft: s.finalDraft,
      voice_match_score: s.voiceMatchScore,
      originality_score: s.originalityScore,
      ai_citation_readiness_score: s.aiCitationReadinessScore,
      citation_completeness: s.citationCompleteness,
      atomic_chunks_count: s.atomicChunksCount,
      atomic_questions_count: s.atomicQuestionsCount,
      banned_phrase_count: s.bannedPhraseCount,
      word_count: s.wordCount,
      schema_markup_recommendations: s.schemaMarkupRecommendations,
      article_schema: s.articleSchema,
      validation: s.validation,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * GET /api/projects/:id/interview-answers?sectionId=<id>
 */
router.get("/:id/interview-answers", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, projectId);
    const sectionId = typeof req.query.sectionId === "string" ? req.query.sectionId
      : typeof req.query["section_id"] === "string" ? (req.query["section_id"] as string) : null;
    const rows = await db
      .select()
      .from(interviewAnswersTable)
      .where(
        sectionId
          ? and(eq(interviewAnswersTable.projectId, projectId), eq(interviewAnswersTable.brandId, brandId), eq(interviewAnswersTable.sectionId, sectionId))
          : and(eq(interviewAnswersTable.projectId, projectId), eq(interviewAnswersTable.brandId, brandId)),
      )
      .orderBy(interviewAnswersTable.createdAt);
    res.json(rows.map((a) => ({
      id: a.id,
      project_id: a.projectId,
      section_id: a.sectionId,
      question: a.question,
      answer: a.answer,
      follow_up: a.followUp,
      created_at: a.createdAt,
    })));
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

/**
 * POST /api/projects/:id/interview-answers
 */
router.post("/:id/interview-answers", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.params["id"] as string;
    const brandId = await assertBrandAccessForProject(req, projectId);
    const { section_id, question, answer } = req.body as { section_id?: string; question?: string; answer?: string };
    if (!section_id) { res.status(400).json({ error: "section_id required" }); return; }

    const [inserted] = await db.insert(interviewAnswersTable).values({
      projectId,
      brandId,
      sectionId: section_id,
      question: question || null,
      answer: answer || null,
    }).returning();
    res.status(201).json({ id: inserted!.id, ok: true });
  } catch (err) {
    handleRouteError(err, res, next);
  }
});

export default router;
