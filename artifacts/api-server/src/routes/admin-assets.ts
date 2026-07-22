import { Router } from "express";
import {
  db,
  brandsTable,
  reviewsBankEntriesTable,
  linkTargetsTable,
  linkingRulesTable,
  moduleDataProvenanceTable,
  contentPlanTemplatesTable,
  getResolvedTemplate,
  type InsertReviewsBankEntry,
  type InsertLinkTarget,
  type InsertLinkingRule,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth.js";
import { eq, and, desc, asc, isNull } from "drizzle-orm";
import ExcelJS from "exceljs";

/**
 * Admin asset-ingestion endpoints (ContentForge Quality Fix v2, dispatch §2).
 *
 * Mounted under /api/admin (requireAdmin applied here so this router is safe to
 * mount alongside the existing admin router). These follow the established
 * admin convention: plain Express + direct `db` (cross-brand reads are
 * intentional for admins), snake_case JSON in and out, no OpenAPI codegen.
 *
 * EVERY write emits a `module_data_provenance` row. Imports are tagged
 * source_module='system', generation_method='import'; manual edits/deletes are
 * tagged source_module='content-forge' (the admin acts inside ContentForge)
 * with source_user_id = the acting admin.
 *
 * DELETE semantics (per dispatcher override of §2.1's "soft delete" text):
 *   - reviews-bank DELETE is a HARD delete and REQUIRES a `reason` enum
 *     (fabricated | misattributed | client_requested_removal | duplicate |
 *     other). The provenance row is written BEFORE the row is removed and
 *     carries no FK to the review, so the audit trail survives the hard delete.
 *   - link-targets DELETE is a SOFT delete (is_active = false) so links can be
 *     retired without losing history.
 */

const router = Router();
router.use(requireAdmin);

const REVIEW_DELETE_REASONS = [
  "fabricated",
  "misattributed",
  "client_requested_removal",
  "duplicate",
  "other",
] as const;
type ReviewDeleteReason = (typeof REVIEW_DELETE_REASONS)[number];

const FUNNEL_STAGES = ["TOFU", "MOFU", "BOFU"] as const;

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveBrandId(raw: unknown): Promise<string | null> {
  if (typeof raw !== "string" || !UUID_RE.test(raw)) return null;
  const rows = await db
    .select({ id: brandsTable.id })
    .from(brandsTable)
    .where(eq(brandsTable.id, raw))
    .limit(1);
  return rows[0]?.id ?? null;
}

type ProvenanceInput = {
  brandId: string;
  entityType: string;
  entityId: string;
  sourceModule: "content-forge" | "seo-os" | "system";
  sourceUserId?: string | null;
  generationMethod: string;
  metadata?: Record<string, unknown>;
};

/** Insert one provenance row. Accepts a tx or the root db so it can join the
 *  same transaction as the write it audits. */
async function writeProvenance(
  exec: typeof db,
  p: ProvenanceInput,
): Promise<void> {
  await exec.insert(moduleDataProvenanceTable).values({
    brandId: p.brandId,
    entityType: p.entityType,
    entityId: p.entityId,
    sourceModule: p.sourceModule,
    sourceUserId: p.sourceUserId ?? null,
    generationMethod: p.generationMethod,
    metadata: p.metadata ?? {},
  });
}

function s(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim())
    return v
      .split(/[,;|\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
  return [];
}

/* -------------------------------------------------------------------------- */
/* snake_case serializers                                                     */
/* -------------------------------------------------------------------------- */

function reviewToSnake(r: typeof reviewsBankEntriesTable.$inferSelect) {
  return {
    id: r.id,
    brand_id: r.brandId,
    reviewer_name: r.reviewerName,
    reviewer_role: r.reviewerRole,
    company: r.company,
    company_industry: r.companyIndustry,
    project_name: r.projectName,
    quote_excerpt: r.quoteExcerpt,
    quote_full: r.quoteFull,
    rating: r.rating,
    source_url: r.sourceUrl,
    date_published: r.datePublished,
    icp: r.icp,
    vertical: r.vertical,
    cost_bucket: r.costBucket,
    outcome_metrics: r.outcomeMetrics,
    is_confidential: r.isConfidential,
    confidential_reason: r.confidentialReason,
    imported_at: r.importedAt,
    last_verified_at: r.lastVerifiedAt,
  };
}

function linkTargetToSnake(r: typeof linkTargetsTable.$inferSelect) {
  return {
    id: r.id,
    brand_id: r.brandId,
    url: r.url,
    page_title: r.pageTitle,
    page_type: r.pageType,
    content_cluster: r.contentCluster,
    vertical: r.vertical,
    funnel_stage: r.funnelStage,
    primary_icp: r.primaryIcp,
    primary_keyword: r.primaryKeyword,
    anchor_variations: r.anchorVariations,
    use_for: r.useFor,
    is_active: r.isActive,
    imported_at: r.importedAt,
    last_verified_at: r.lastVerifiedAt,
  };
}

function linkingRuleToSnake(r: typeof linkingRulesTable.$inferSelect) {
  return {
    id: r.id,
    brand_id: r.brandId,
    trigger_pattern: r.triggerPattern,
    trigger_keywords: r.triggerKeywords,
    primary_target_urls: r.primaryTargetUrls,
    notes: r.notes,
    created_at: r.createdAt,
  };
}

/* ========================================================================== */
/* Reviews bank                                                               */
/* ========================================================================== */

/** Map a raw review object (snake_case from reviews_bank.json) to insert cols. */
function mapReview(raw: Record<string, unknown>, brandId: string) {
  const reviewerName = s(raw.reviewer_name) ?? s(raw.reviewerName);
  const company = s(raw.company);
  const quoteExcerpt =
    s(raw.quote_excerpt) ?? s(raw.quoteExcerpt) ?? s(raw.quote);
  if (!reviewerName || !company || !quoteExcerpt) return null;
  const entry: InsertReviewsBankEntry = {
    brandId,
    reviewerName,
    company,
    quoteExcerpt,
    reviewerRole: s(raw.reviewer_role) ?? s(raw.reviewerRole),
    companyIndustry: s(raw.company_industry) ?? s(raw.companyIndustry),
    projectName: s(raw.project_name) ?? s(raw.projectName),
    quoteFull: s(raw.quote_full) ?? s(raw.quoteFull),
    rating: s(raw.rating),
    sourceUrl: s(raw.source_url) ?? s(raw.sourceUrl),
    datePublished: s(raw.date_published) ?? s(raw.datePublished),
    icp: num(raw.icp),
    vertical: s(raw.vertical),
    costBucket: s(raw.cost_bucket) ?? s(raw.costBucket),
    outcomeMetrics:
      raw.outcome_metrics && typeof raw.outcome_metrics === "object"
        ? (raw.outcome_metrics as Record<string, unknown>)
        : {},
    isConfidential:
      raw.is_confidential === true || raw.isConfidential === true,
    confidentialReason:
      s(raw.confidential_reason) ?? s(raw.confidentialReason),
    lastVerifiedAt: new Date(),
  };
  return entry;
}

/**
 * POST /api/admin/reviews-bank/import?brandId=...
 * Body: array of review objects OR { brand_id, reviews: [...] }.
 * Upserts by (brand_id, reviewer_name, company). One provenance row per import.
 */
router.post("/reviews-bank/import", async (req, res, next) => {
  try {
    const body = req.body as unknown;
    const rawArray = Array.isArray(body)
      ? body
      : Array.isArray((body as { reviews?: unknown })?.reviews)
        ? (body as { reviews: unknown[] }).reviews
        : null;
    if (!rawArray) {
      res
        .status(400)
        .json({ error: "body must be an array of reviews or { reviews: [] }" });
      return;
    }
    const brandId = await resolveBrandId(
      req.query.brandId ?? (body as { brand_id?: unknown })?.brand_id,
    );
    if (!brandId) {
      res.status(400).json({ error: "valid brandId is required" });
      return;
    }

    const sourceFile =
      s((body as { source_file?: unknown })?.source_file) ?? "reviews_bank.json";

    const mapped = rawArray
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => mapReview(x, brandId))
      .filter((x): x is InsertReviewsBankEntry => x !== null);

    if (mapped.length === 0) {
      res.status(400).json({
        error:
          "no valid reviews found (each needs reviewer_name, company, quote_excerpt)",
      });
      return;
    }

    const count = await db.transaction(async (tx) => {
      for (const entry of mapped) {
        await tx
          .insert(reviewsBankEntriesTable)
          .values(entry)
          .onConflictDoUpdate({
            target: [
              reviewsBankEntriesTable.brandId,
              reviewsBankEntriesTable.reviewerName,
              reviewsBankEntriesTable.company,
            ],
            set: {
              reviewerRole: entry.reviewerRole,
              companyIndustry: entry.companyIndustry,
              projectName: entry.projectName,
              quoteExcerpt: entry.quoteExcerpt,
              quoteFull: entry.quoteFull,
              rating: entry.rating,
              sourceUrl: entry.sourceUrl,
              datePublished: entry.datePublished,
              icp: entry.icp,
              vertical: entry.vertical,
              costBucket: entry.costBucket,
              outcomeMetrics: entry.outcomeMetrics,
              isConfidential: entry.isConfidential,
              confidentialReason: entry.confidentialReason,
              lastVerifiedAt: new Date(),
            },
          });
      }
      await writeProvenance(tx as unknown as typeof db, {
        brandId,
        entityType: "reviews_bank_import",
        entityId: brandId,
        sourceModule: "system",
        sourceUserId: req.auth?.userId ?? null,
        generationMethod: "import",
        metadata: { source_file: sourceFile, count: mapped.length },
      });
      return mapped.length;
    });

    res.json({ imported: count, brand_id: brandId });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/reviews-bank?brandId=...  — list all entries for a brand. */
router.get("/reviews-bank", async (req, res, next) => {
  try {
    const brandId = await resolveBrandId(req.query.brandId);
    if (!brandId) {
      res.status(400).json({ error: "valid brandId is required" });
      return;
    }
    const rows = await db
      .select()
      .from(reviewsBankEntriesTable)
      .where(eq(reviewsBankEntriesTable.brandId, brandId))
      .orderBy(
        asc(reviewsBankEntriesTable.icp),
        asc(reviewsBankEntriesTable.vertical),
        asc(reviewsBankEntriesTable.company),
      );
    res.json(rows.map(reviewToSnake));
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/reviews-bank/:id — edit a single entry (+ provenance). */
router.patch("/reviews-bank/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const existing = await db
      .select()
      .from(reviewsBankEntriesTable)
      .where(eq(reviewsBankEntriesTable.id, id))
      .limit(1);
    const row = existing[0];
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const b = req.body as Record<string, unknown>;
    const patch: Partial<InsertReviewsBankEntry> = {};
    if ("is_confidential" in b) patch.isConfidential = b.is_confidential === true;
    if ("confidential_reason" in b)
      patch.confidentialReason = s(b.confidential_reason);
    if ("reviewer_role" in b) patch.reviewerRole = s(b.reviewer_role);
    if ("quote_excerpt" in b) {
      const q = s(b.quote_excerpt);
      if (q) patch.quoteExcerpt = q;
    }
    if ("quote_full" in b) patch.quoteFull = s(b.quote_full);
    if ("icp" in b) patch.icp = num(b.icp);
    if ("vertical" in b) patch.vertical = s(b.vertical);
    if ("cost_bucket" in b) patch.costBucket = s(b.cost_bucket);
    if ("rating" in b) patch.rating = s(b.rating);
    if ("outcome_metrics" in b && typeof b.outcome_metrics === "object")
      patch.outcomeMetrics = b.outcome_metrics as Record<string, unknown>;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no editable fields supplied" });
      return;
    }
    patch.lastVerifiedAt = new Date();

    const updated = await db.transaction(async (tx) => {
      const u = await tx
        .update(reviewsBankEntriesTable)
        .set(patch)
        .where(eq(reviewsBankEntriesTable.id, id))
        .returning();
      await writeProvenance(tx as unknown as typeof db, {
        brandId: row.brandId,
        entityType: "reviews_bank_entry",
        entityId: id,
        sourceModule: "content-forge",
        sourceUserId: req.auth?.userId ?? null,
        generationMethod: "manual",
        metadata: { fields: Object.keys(patch) },
      });
      return u[0]!;
    });

    res.json(reviewToSnake(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/reviews-bank/:id — HARD delete. Requires a `reason` enum
 * (query ?reason= or JSON body { reason }). Provenance written BEFORE removal.
 */
router.delete("/reviews-bank/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const reasonRaw =
      s(req.query.reason) ?? s((req.body as { reason?: unknown })?.reason);
    if (
      !reasonRaw ||
      !REVIEW_DELETE_REASONS.includes(reasonRaw as ReviewDeleteReason)
    ) {
      res.status(400).json({
        error: `reason is required and must be one of: ${REVIEW_DELETE_REASONS.join(", ")}`,
      });
      return;
    }
    const note = s((req.body as { note?: unknown })?.note);

    const existing = await db
      .select()
      .from(reviewsBankEntriesTable)
      .where(eq(reviewsBankEntriesTable.id, id))
      .limit(1);
    const row = existing[0];
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }

    await db.transaction(async (tx) => {
      // Provenance first — it carries no FK to the review, so the audit
      // record outlives the hard delete.
      await writeProvenance(tx as unknown as typeof db, {
        brandId: row.brandId,
        entityType: "reviews_bank_entry",
        entityId: id,
        sourceModule: "content-forge",
        sourceUserId: req.auth?.userId ?? null,
        generationMethod: "delete",
        metadata: {
          hard_delete: true,
          reason: reasonRaw,
          note: note ?? undefined,
          reviewer_name: row.reviewerName,
          company: row.company,
        },
      });
      await tx
        .delete(reviewsBankEntriesTable)
        .where(eq(reviewsBankEntriesTable.id, id));
    });

    res.json({ deleted: id, reason: reasonRaw, hard_delete: true });
  } catch (err) {
    next(err);
  }
});

/* ========================================================================== */
/* Link targets + linking rules                                              */
/* ========================================================================== */

function mapLinkTarget(raw: Record<string, unknown>, brandId: string) {
  const url = s(raw.url);
  const pageType = s(raw.page_type) ?? s(raw.pageType) ?? "page";
  let funnelStage = (s(raw.funnel_stage) ?? s(raw.funnelStage) ?? "")
    .toUpperCase()
    .trim();
  if (!FUNNEL_STAGES.includes(funnelStage as (typeof FUNNEL_STAGES)[number]))
    funnelStage = "TOFU";
  if (!url) return null;
  const entry: InsertLinkTarget = {
    brandId,
    url,
    pageType,
    funnelStage,
    pageTitle: s(raw.page_title) ?? s(raw.pageTitle),
    contentCluster: s(raw.content_cluster) ?? s(raw.contentCluster),
    vertical: s(raw.vertical),
    primaryIcp: num(raw.primary_icp ?? raw.primaryIcp),
    primaryKeyword: s(raw.primary_keyword) ?? s(raw.primaryKeyword),
    anchorVariations: strArray(raw.anchor_variations ?? raw.anchorVariations),
    useFor: s(raw.use_for) ?? s(raw.useFor),
    isActive: raw.is_active === false ? false : true,
    lastVerifiedAt: new Date(),
  };
  return entry;
}

function mapLinkingRule(raw: Record<string, unknown>, brandId: string) {
  const triggerPattern = s(raw.trigger_pattern) ?? s(raw.triggerPattern);
  if (!triggerPattern) return null;
  const entry: InsertLinkingRule = {
    brandId,
    triggerPattern,
    triggerKeywords: strArray(raw.trigger_keywords ?? raw.triggerKeywords),
    primaryTargetUrls: strArray(raw.primary_target_urls ?? raw.primaryTargetUrls),
    notes: s(raw.notes),
  };
  return entry;
}

/**
 * Parse an internal_linking.xlsx workbook (base64) into link targets + rules.
 *
 * Header matching is tolerant (case-insensitive, ignores spaces/underscores)
 * so the canonical file's exact column casing need not be known in advance.
 * Expected sheets (matched by name substring; falls back to sheet order):
 *   - "Link Targets" → columns: url, page_title, page_type, content_cluster,
 *     vertical, funnel_stage, primary_icp, primary_keyword, anchor_variations,
 *     use_for
 *   - "Linking Rules" → columns: trigger_pattern, trigger_keywords,
 *     primary_target_urls, notes
 */
async function parseLinkingWorkbook(base64: string): Promise<{
  link_targets: Record<string, unknown>[];
  linking_rules: Record<string, unknown>[];
}> {
  const wb = new ExcelJS.Workbook();
  // exceljs's bundled types expect a non-generic global `Buffer`, while
  // @types/node now types `Buffer.from` as `Buffer<ArrayBufferLike>`; cast the
  // argument to the load() param type to sidestep that purely-typing mismatch.
  type LoadArg = Parameters<typeof wb.xlsx.load>[0];
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as LoadArg);

  const norm = (h: unknown) =>
    String(h ?? "")
      .toLowerCase()
      .replace(/[\s_-]+/g, "");

  const sheetToRows = (ws: ExcelJS.Worksheet): Record<string, unknown>[] => {
    const rows: Record<string, unknown>[] = [];
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, col) => {
      headers[col] = norm(cell.value);
    });
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const obj: Record<string, unknown> = {};
      let hasValue = false;
      row.eachCell((cell, col) => {
        const key = headers[col];
        if (!key) return;
        const v = cell.value;
        const val = v && typeof v === "object" && "text" in v ? v.text : v;
        if (val != null && String(val).trim() !== "") hasValue = true;
        obj[key] = val;
      });
      if (hasValue) rows.push(obj);
    }
    return rows;
  };

  const pickSheet = (re: RegExp): ExcelJS.Worksheet | undefined =>
    wb.worksheets.find((w) => re.test(w.name));

  const targetsWs = pickSheet(/link\s*targets?/i) ?? wb.worksheets[0];
  const rulesWs = pickSheet(/link(ing)?\s*rules?/i) ?? wb.worksheets[1];

  const remapTarget = (o: Record<string, unknown>) => ({
    url: o.url,
    page_title: o.pagetitle,
    page_type: o.pagetype,
    content_cluster: o.contentcluster ?? o.cluster,
    vertical: o.vertical,
    funnel_stage: o.funnelstage ?? o.funnel,
    primary_icp: o.primaryicp ?? o.icp,
    primary_keyword: o.primarykeyword ?? o.keyword,
    anchor_variations: o.anchorvariations ?? o.anchors,
    use_for: o.usefor,
    is_active: o.isactive,
  });
  const remapRule = (o: Record<string, unknown>) => ({
    trigger_pattern: o.triggerpattern ?? o.pattern ?? o.cluster,
    trigger_keywords: o.triggerkeywords ?? o.keywords,
    primary_target_urls: o.primarytargeturls ?? o.targets ?? o.urls,
    notes: o.notes,
  });

  return {
    link_targets: targetsWs ? sheetToRows(targetsWs).map(remapTarget) : [],
    linking_rules:
      rulesWs && rulesWs !== targetsWs
        ? sheetToRows(rulesWs).map(remapRule)
        : [],
  };
}

/**
 * POST /api/admin/link-targets/import?brandId=...
 * Body: { link_targets[], linking_rules[] } OR { xlsx_base64 } (internal_linking.xlsx).
 * Upserts link_targets by (brand_id, url); replaces linking_rules for the brand.
 */
router.post("/link-targets/import", async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const brandId = await resolveBrandId(req.query.brandId ?? body?.brand_id);
    if (!brandId) {
      res.status(400).json({ error: "valid brandId is required" });
      return;
    }

    let rawTargets: unknown;
    let rawRules: unknown;
    let sourceFile = "internal_linking.json";
    const xlsxB64 = s(body?.xlsx_base64);
    if (xlsxB64) {
      const parsed = await parseLinkingWorkbook(xlsxB64);
      rawTargets = parsed.link_targets;
      rawRules = parsed.linking_rules;
      sourceFile = s(body?.source_file) ?? "internal_linking.xlsx";
    } else {
      rawTargets = body?.link_targets;
      rawRules = body?.linking_rules;
      sourceFile = s(body?.source_file) ?? sourceFile;
    }

    const targets = (Array.isArray(rawTargets) ? rawTargets : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => mapLinkTarget(x, brandId))
      .filter((x): x is InsertLinkTarget => x !== null);
    const rules = (Array.isArray(rawRules) ? rawRules : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => mapLinkingRule(x, brandId))
      .filter((x): x is InsertLinkingRule => x !== null);

    if (targets.length === 0 && rules.length === 0) {
      res.status(400).json({
        error:
          "no valid link_targets (need url) or linking_rules (need trigger_pattern) found",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      for (const t of targets) {
        await tx
          .insert(linkTargetsTable)
          .values(t)
          .onConflictDoUpdate({
            target: [linkTargetsTable.brandId, linkTargetsTable.url],
            set: {
              pageTitle: t.pageTitle,
              pageType: t.pageType,
              contentCluster: t.contentCluster,
              vertical: t.vertical,
              funnelStage: t.funnelStage,
              primaryIcp: t.primaryIcp,
              primaryKeyword: t.primaryKeyword,
              anchorVariations: t.anchorVariations,
              useFor: t.useFor,
              isActive: t.isActive,
              lastVerifiedAt: new Date(),
            },
          });
      }
      // Linking rules have no natural unique key — replace the brand's set.
      if (rules.length > 0) {
        await tx
          .delete(linkingRulesTable)
          .where(eq(linkingRulesTable.brandId, brandId));
        await tx.insert(linkingRulesTable).values(rules);
      }
      await writeProvenance(tx as unknown as typeof db, {
        brandId,
        entityType: "link_targets_import",
        entityId: brandId,
        sourceModule: "system",
        sourceUserId: req.auth?.userId ?? null,
        generationMethod: "import",
        metadata: {
          source_file: sourceFile,
          link_targets: targets.length,
          linking_rules: rules.length,
        },
      });
      return { link_targets: targets.length, linking_rules: rules.length };
    });

    res.json({ imported: result, brand_id: brandId });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/link-targets?brandId=...  — list targets + rules for a brand. */
router.get("/link-targets", async (req, res, next) => {
  try {
    const brandId = await resolveBrandId(req.query.brandId);
    if (!brandId) {
      res.status(400).json({ error: "valid brandId is required" });
      return;
    }
    const includeInactive = s(req.query.include_inactive) === "true";
    const targetRows = await db
      .select()
      .from(linkTargetsTable)
      .where(
        includeInactive
          ? eq(linkTargetsTable.brandId, brandId)
          : and(
              eq(linkTargetsTable.brandId, brandId),
              eq(linkTargetsTable.isActive, true),
            ),
      )
      .orderBy(
        asc(linkTargetsTable.contentCluster),
        asc(linkTargetsTable.funnelStage),
        asc(linkTargetsTable.url),
      );
    const ruleRows = await db
      .select()
      .from(linkingRulesTable)
      .where(eq(linkingRulesTable.brandId, brandId))
      .orderBy(desc(linkingRulesTable.createdAt));
    res.json({
      link_targets: targetRows.map(linkTargetToSnake),
      linking_rules: ruleRows.map(linkingRuleToSnake),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/admin/link-targets/:id — update a link target (+ provenance). */
router.patch("/link-targets/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const existing = await db
      .select()
      .from(linkTargetsTable)
      .where(eq(linkTargetsTable.id, id))
      .limit(1);
    const row = existing[0];
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const b = req.body as Record<string, unknown>;
    const patch: Partial<InsertLinkTarget> = {};
    if ("page_title" in b) patch.pageTitle = s(b.page_title);
    if ("page_type" in b) {
      const pt = s(b.page_type);
      if (pt) patch.pageType = pt;
    }
    if ("content_cluster" in b) patch.contentCluster = s(b.content_cluster);
    if ("vertical" in b) patch.vertical = s(b.vertical);
    if ("funnel_stage" in b) {
      const fs = (s(b.funnel_stage) ?? "").toUpperCase();
      if (FUNNEL_STAGES.includes(fs as (typeof FUNNEL_STAGES)[number]))
        patch.funnelStage = fs;
    }
    if ("primary_icp" in b) patch.primaryIcp = num(b.primary_icp);
    if ("primary_keyword" in b) patch.primaryKeyword = s(b.primary_keyword);
    if ("anchor_variations" in b)
      patch.anchorVariations = strArray(b.anchor_variations);
    if ("use_for" in b) patch.useFor = s(b.use_for);
    if ("is_active" in b) patch.isActive = b.is_active === true;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no editable fields supplied" });
      return;
    }
    patch.lastVerifiedAt = new Date();

    const updated = await db.transaction(async (tx) => {
      const u = await tx
        .update(linkTargetsTable)
        .set(patch)
        .where(eq(linkTargetsTable.id, id))
        .returning();
      await writeProvenance(tx as unknown as typeof db, {
        brandId: row.brandId,
        entityType: "link_target",
        entityId: id,
        sourceModule: "content-forge",
        sourceUserId: req.auth?.userId ?? null,
        generationMethod: "manual",
        metadata: { fields: Object.keys(patch) },
      });
      return u[0]!;
    });

    res.json(linkTargetToSnake(updated));
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/admin/link-targets/:id — SOFT delete (is_active = false). */
router.delete("/link-targets/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const existing = await db
      .select()
      .from(linkTargetsTable)
      .where(eq(linkTargetsTable.id, id))
      .limit(1);
    const row = existing[0];
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(linkTargetsTable)
        .set({ isActive: false, lastVerifiedAt: new Date() })
        .where(eq(linkTargetsTable.id, id));
      await writeProvenance(tx as unknown as typeof db, {
        brandId: row.brandId,
        entityType: "link_target",
        entityId: id,
        sourceModule: "content-forge",
        sourceUserId: req.auth?.userId ?? null,
        generationMethod: "delete",
        metadata: { soft_delete: true, url: row.url },
      });
    });

    res.json({ deactivated: id, soft_delete: true });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Content Plan Templates — Rules Dashboard CRUD (Phase 2)                    */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/admin/content-plan-templates?brandId=
 *
 * Returns all active templates for the brand (one global + up to 8 per-type)
 * as { global: Template|null, byType: Record<string, Template> }.
 * Admin-only (requireAdmin on this router).
 */
router.get("/content-plan-templates", async (req, res, next) => {
  try {
    const brandId = await resolveBrandId(req.query.brandId);
    if (!brandId) { res.status(400).json({ error: "brandId required" }); return; }

    const rows = await db
      .select()
      .from(contentPlanTemplatesTable)
      .where(and(eq(contentPlanTemplatesTable.brandId, brandId), eq(contentPlanTemplatesTable.isActive, true)))
      .orderBy(contentPlanTemplatesTable.scope, contentPlanTemplatesTable.contentType);

    const globalRow = rows.find((r) => r.scope === "global") ?? null;
    const byType: Record<string, typeof rows[0]> = {};
    for (const r of rows.filter((r) => r.scope === "content_type")) {
      if (r.contentType) byType[r.contentType] = r;
    }
    res.json({ global: globalRow, byType });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/content-plan-templates/resolve?brandId=&contentType=
 *
 * Returns the fully resolved template for a brand + content type — all null
 * per-type overrides replaced by global cascade values, with provenance flags.
 * This is the single source of truth for cascade logic. Preview mode, the
 * planner AI, and the plan compliance report must all use this endpoint rather
 * than re-implementing cascade independently.
 *
 * Returns 404 when no global template exists for the brand (unresolvable).
 */
router.get("/content-plan-templates/resolve", async (req, res, next) => {
  try {
    const brandId = await resolveBrandId(req.query.brandId);
    if (!brandId) { res.status(400).json({ error: "brandId required" }); return; }
    const contentType = typeof req.query.contentType === "string" ? req.query.contentType.trim() : "";
    if (!contentType) { res.status(400).json({ error: "contentType required" }); return; }

    const resolved = await getResolvedTemplate(brandId, contentType);
    if (!resolved) {
      res.status(404).json({ error: "No active global template found for this brand. Configure global rules first." });
      return;
    }
    res.json(resolved);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/content-plan-templates
 *
 * Creates a new template version for the given brand/scope/contentType.
 * If no prior version exists, inserts version 1.
 * If a prior active version exists, increments version and deactivates the old row.
 * Returns the new template row.
 *
 * Body: { brandId, scope: 'global'|'content_type', contentType?: string, template_data: {...} }
 */
router.put("/content-plan-templates", async (req, res, next) => {
  try {
    const { brandId: rawBrandId, scope, contentType, template_data } = req.body as {
      brandId?: string;
      scope?: string;
      contentType?: string | null;
      template_data?: unknown;
    };

    const brandId = await resolveBrandId(rawBrandId);
    if (!brandId) { res.status(400).json({ error: "brandId required" }); return; }
    if (scope !== "global" && scope !== "content_type") {
      res.status(400).json({ error: "scope must be 'global' or 'content_type'" });
      return;
    }
    if (scope === "content_type" && !contentType) {
      res.status(400).json({ error: "contentType required for scope=content_type" });
      return;
    }
    if (!template_data || typeof template_data !== "object") {
      res.status(400).json({ error: "template_data object required" });
      return;
    }

    const tpl = contentPlanTemplatesTable;

    const conds = [
      eq(tpl.brandId, brandId),
      eq(tpl.scope, scope),
      eq(tpl.isActive, true),
      scope === "global"
        ? isNull(tpl.contentType)
        : eq(tpl.contentType, contentType!),
    ];

    const existing = await db.select().from(tpl).where(and(...conds)).limit(1);
    const current = existing[0] ?? null;
    const nextVersion = current ? current.version + 1 : 1;
    const actingUser = req.auth?.userId ?? null;

    const [newRow] = await db.transaction(async (tx) => {
      if (current) {
        await tx.update(tpl).set({ isActive: false }).where(eq(tpl.id, current.id));
      }
      return tx
        .insert(tpl)
        .values({
          brandId,
          scope,
          contentType: scope === "global" ? null : contentType!,
          version: nextVersion,
          templateData: template_data as Record<string, unknown>,
          isActive: true,
          createdBy: actingUser,
        })
        .returning();
    });

    res.json({ template: newRow, previous_version: current?.version ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
