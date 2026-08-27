/**
 * Schema smoke tests — catch insert-type regressions at typecheck + test time.
 *
 * STRATEGY
 * ─────────
 * Two complementary layers:
 *
 * 1. COMPILE-TIME (TypeScript):
 *    `_minInsert` constants are typed against `typeof table.$inferInsert`.
 *    If a column's nullable/notNull status drifts in the schema file, the
 *    required-key set changes and these assignments fail to compile.
 *    Run: `pnpm run typecheck:libs && pnpm --filter @workspace/db run typecheck:tests`
 *
 * 2. RUNTIME (Zod via drizzle-zod):
 *    `createInsertSchema` generates a Zod schema from the Drizzle table
 *    definition. Tests assert that:
 *      - brand_id is REQUIRED (missing → ZodError)
 *      - the minimal valid object parses without error
 *      - accidentally nullable brand_id is caught by Zod (it would become
 *        optional in the generated schema)
 *
 * No database connection is needed — all tests are pure type/schema checks.
 *
 * Scope: every table with a NOT NULL brand_id or a NOT NULL user-id primary key.
 */
import { describe, it, expect } from "vitest";
import { createInsertSchema } from "drizzle-zod";

import {
  brandsTable,
  userProfilesTable,
  projectsTable,
  draftsTable,
  researchBriefsTable,
  contentObjectsTable,
  outlinesTable,
  proofPointsTable,
  draftScoresTable,
  interviewAnswersTable,
  qaRunsTable,
  qaCheckResultsTable,
  qaSignoffsTable,
  qaOverridesTable,
  qaCheckDefinitionsTable,
  recoveryBaselinesTable,
  recoveryInitiativesTable,
  recoverySnapshotsTable,
  eventsTable,
  auditLogTable,
  usageLogsTable,
  integrationCallLogTable,
  fetchedPagesTable,
  playbookTable,
  playbookSectionsTable,
  voiceLibraryTable,
} from "../src/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time sentinel type
// Extracts the set of keys that are REQUIRED (not optional) in an insert type.
// ─────────────────────────────────────────────────────────────────────────────
type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * If `K` is optional in `T.$inferInsert` this line will produce a
 * TypeScript compile error — catching the regression immediately.
 */
type AssertRequiredField<
  _Table extends { $inferInsert: object },
  K extends RequiredKeys<_Table["$inferInsert"]>,
> = K;

// ── brands ───────────────────────────────────────────────────────────────────
type _BrandsSlugRequired = AssertRequiredField<typeof brandsTable, "slug">;
type _BrandsNameRequired = AssertRequiredField<typeof brandsTable, "name">;

// ── user_profiles ─────────────────────────────────────────────────────────
type _UserProfileUserIdRequired = AssertRequiredField<typeof userProfilesTable, "userId">;

// ── projects ─────────────────────────────────────────────────────────────────
type _ProjectBrandIdRequired     = AssertRequiredField<typeof projectsTable, "brandId">;
type _ProjectTopicRequired       = AssertRequiredField<typeof projectsTable, "topic">;

// ── drafts ───────────────────────────────────────────────────────────────────
type _DraftBrandIdRequired   = AssertRequiredField<typeof draftsTable, "brandId">;
type _DraftProjectIdRequired = AssertRequiredField<typeof draftsTable, "projectId">;
type _DraftSectionIdRequired = AssertRequiredField<typeof draftsTable, "sectionId">;

// ── research_briefs ───────────────────────────────────────────────────────────
type _ResearchBriefBrandIdRequired   = AssertRequiredField<typeof researchBriefsTable, "brandId">;
type _ResearchBriefProjectIdRequired = AssertRequiredField<typeof researchBriefsTable, "projectId">;

// ── content_objects ───────────────────────────────────────────────────────────
type _ContentObjectBrandIdRequired   = AssertRequiredField<typeof contentObjectsTable, "brandId">;
type _ContentObjectProjectIdRequired = AssertRequiredField<typeof contentObjectsTable, "projectId">;

// ── outlines ──────────────────────────────────────────────────────────────────
type _OutlineBrandIdRequired   = AssertRequiredField<typeof outlinesTable, "brandId">;
type _OutlineProjectIdRequired = AssertRequiredField<typeof outlinesTable, "projectId">;

// ── proof_points ──────────────────────────────────────────────────────────────
type _ProofPointBrandIdRequired   = AssertRequiredField<typeof proofPointsTable, "brandId">;
type _ProofPointProjectIdRequired = AssertRequiredField<typeof proofPointsTable, "projectId">;
type _ProofPointClaimRequired     = AssertRequiredField<typeof proofPointsTable, "claim">;

// ── draft_scores ──────────────────────────────────────────────────────────────
type _DraftScoreBrandIdRequired   = AssertRequiredField<typeof draftScoresTable, "brandId">;
type _DraftScoreProjectIdRequired = AssertRequiredField<typeof draftScoresTable, "projectId">;

// ── interview_answers ─────────────────────────────────────────────────────────
type _InterviewAnswerBrandIdRequired   = AssertRequiredField<typeof interviewAnswersTable, "brandId">;
type _InterviewAnswerProjectIdRequired = AssertRequiredField<typeof interviewAnswersTable, "projectId">;
type _InterviewAnswerSectionIdRequired = AssertRequiredField<typeof interviewAnswersTable, "sectionId">;

// ── qa_runs ───────────────────────────────────────────────────────────────────
type _QaRunBrandIdRequired         = AssertRequiredField<typeof qaRunsTable, "brandId">;
type _QaRunContentObjectIdRequired = AssertRequiredField<typeof qaRunsTable, "contentObjectId">;

// ── qa_check_results ──────────────────────────────────────────────────────────
type _QaCheckResultBrandIdRequired   = AssertRequiredField<typeof qaCheckResultsTable, "brandId">;
type _QaCheckResultQaRunIdRequired   = AssertRequiredField<typeof qaCheckResultsTable, "qaRunId">;
type _QaCheckResultCheckNameRequired = AssertRequiredField<typeof qaCheckResultsTable, "checkName">;
type _QaCheckResultSeverityRequired  = AssertRequiredField<typeof qaCheckResultsTable, "severity">;
type _QaCheckResultOutcomeRequired   = AssertRequiredField<typeof qaCheckResultsTable, "outcome">;

// ── qa_signoffs ───────────────────────────────────────────────────────────────
type _QaSignoffBrandIdRequired         = AssertRequiredField<typeof qaSignoffsTable, "brandId">;
type _QaSignoffContentObjectIdRequired = AssertRequiredField<typeof qaSignoffsTable, "contentObjectId">;
type _QaSignoffReviewerIdRequired      = AssertRequiredField<typeof qaSignoffsTable, "reviewerId">;
type _QaSignoffDecisionRequired        = AssertRequiredField<typeof qaSignoffsTable, "decision">;

// ── qa_overrides ──────────────────────────────────────────────────────────────
type _QaOverrideBrandIdRequired       = AssertRequiredField<typeof qaOverridesTable, "brandId">;
type _QaOverrideQaRunIdRequired       = AssertRequiredField<typeof qaOverridesTable, "qaRunId">;
type _QaOverrideCheckNameRequired     = AssertRequiredField<typeof qaOverridesTable, "checkName">;
type _QaOverrideOverriddenByRequired  = AssertRequiredField<typeof qaOverridesTable, "overriddenBy">;
type _QaOverrideJustificationRequired = AssertRequiredField<typeof qaOverridesTable, "justification">;

// ── qa_check_definitions ──────────────────────────────────────────────────────
type _QaCheckDefBrandIdRequired   = AssertRequiredField<typeof qaCheckDefinitionsTable, "brandId">;
type _QaCheckDefCheckNameRequired = AssertRequiredField<typeof qaCheckDefinitionsTable, "checkName">;
type _QaCheckDefSeverityRequired  = AssertRequiredField<typeof qaCheckDefinitionsTable, "severity">;

// ── recovery_baselines ────────────────────────────────────────────────────────
type _RecoveryBaselineBrandIdRequired     = AssertRequiredField<typeof recoveryBaselinesTable, "brandId">;
type _RecoveryBaselineDateRequired        = AssertRequiredField<typeof recoveryBaselinesTable, "baselineDate">;
type _RecoveryBaselineAvgPositionRequired = AssertRequiredField<typeof recoveryBaselinesTable, "baselineAvgPosition">;
type _RecoveryBaselineTop10Required       = AssertRequiredField<typeof recoveryBaselinesTable, "baselineKeywordsInTop10">;
type _RecoveryBaselineTop3Required        = AssertRequiredField<typeof recoveryBaselinesTable, "baselineKeywordsInTop3">;
type _RecoveryBaselineLockedByRequired    = AssertRequiredField<typeof recoveryBaselinesTable, "lockedBy">;

// ── recovery_initiatives ──────────────────────────────────────────────────────
type _RecoveryInitiativeBrandIdRequired   = AssertRequiredField<typeof recoveryInitiativesTable, "brandId">;
type _RecoveryInitiativeNameRequired      = AssertRequiredField<typeof recoveryInitiativesTable, "name">;
type _RecoveryInitiativeTypeRequired      = AssertRequiredField<typeof recoveryInitiativesTable, "type">;
type _RecoveryInitiativeStartedAtRequired = AssertRequiredField<typeof recoveryInitiativesTable, "startedAt">;
type _RecoveryInitiativeCreatedByRequired = AssertRequiredField<typeof recoveryInitiativesTable, "createdBy">;

// ── recovery_snapshots ────────────────────────────────────────────────────────
type _RecoverySnapshotBrandIdRequired     = AssertRequiredField<typeof recoverySnapshotsTable, "brandId">;
type _RecoverySnapshotDateRequired        = AssertRequiredField<typeof recoverySnapshotsTable, "snapshotDate">;
type _RecoverySnapshotAvgPositionRequired = AssertRequiredField<typeof recoverySnapshotsTable, "avgPosition30d">;
type _RecoverySnapshotTop10Required       = AssertRequiredField<typeof recoverySnapshotsTable, "keywordsInTop10">;
type _RecoverySnapshotTop3Required        = AssertRequiredField<typeof recoverySnapshotsTable, "keywordsInTop3">;

// ── fetched_pages (nullable brand_id — system-level page cache) ───────────────
// brand_id is intentionally nullable; url and content are required.
type _FetchedPageUrlRequired     = AssertRequiredField<typeof fetchedPagesTable, "url">;
type _FetchedPageContentRequired = AssertRequiredField<typeof fetchedPagesTable, "content">;

// ── playbook (brand-scoped) ───────────────────────────────────────────────────
type _PlaybookBrandIdRequired = AssertRequiredField<typeof playbookTable, "brandId">;

// ── playbook_sections (brand-scoped) ──────────────────────────────────────────
type _PlaybookSectionBrandIdRequired = AssertRequiredField<typeof playbookSectionsTable, "brandId">;
type _PlaybookSectionNumberRequired  = AssertRequiredField<typeof playbookSectionsTable, "sectionNumber">;
type _PlaybookSectionTitleRequired   = AssertRequiredField<typeof playbookSectionsTable, "sectionTitle">;
type _PlaybookSectionContentRequired = AssertRequiredField<typeof playbookSectionsTable, "sectionContent">;

// ── voice_library (brand-scoped: brand_id NOT NULL in prod) ───────────────────
// originalAiText, editedHumanText, and brandId are required.
type _VoiceLibraryBrandIdRequired         = AssertRequiredField<typeof voiceLibraryTable, "brandId">;
type _VoiceLibraryOriginalAiTextRequired  = AssertRequiredField<typeof voiceLibraryTable, "originalAiText">;
type _VoiceLibraryEditedHumanTextRequired = AssertRequiredField<typeof voiceLibraryTable, "editedHumanText">;

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time: minimal insert objects typed against $inferInsert.
// These fail to compile if required fields change (field added/removed from
// notNull-without-default). They also act as living documentation of the
// exact minimum a caller must supply.
// ─────────────────────────────────────────────────────────────────────────────

// Valid v4 UUIDs (version nibble = 4, variant nibble ∈ {8,9,a,b}).
// Zod's UUID validator enforces the full RFC 4122 format.
const BRAND_UUID   = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const PROJECT_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const QA_RUN_UUID  = "c3d4e5f6-a7b8-4c9d-ae0f-2a3b4c5d6e7f";
const CONTENT_UUID = "d4e5f6a7-b8c9-4d0e-bf1a-3b4c5d6e7f8a";
const USER_UUID    = "e5f6a7b8-c9d0-4e1f-8a2b-4c5d6e7f8a9b";

const _minBrandInsert: typeof brandsTable.$inferInsert = {
  slug: "acme",
  name: "Acme Corp",
};

const _minUserProfileInsert: typeof userProfilesTable.$inferInsert = {
  userId: "user_clerk_abc123",
};

const _minProjectInsert: typeof projectsTable.$inferInsert = {
  brandId: BRAND_UUID,
  topic: "AI in marketing",
  contentType: "blog",
};

const _minDraftInsert: typeof draftsTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
  sectionId: "intro",
};

const _minResearchBriefInsert: typeof researchBriefsTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
};

const _minContentObjectInsert: typeof contentObjectsTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
};

const _minOutlineInsert: typeof outlinesTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
};

const _minProofPointInsert: typeof proofPointsTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
  claim: "AI will transform marketing by 2027",
};

const _minDraftScoreInsert: typeof draftScoresTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
};

const _minInterviewAnswerInsert: typeof interviewAnswersTable.$inferInsert = {
  brandId: BRAND_UUID,
  projectId: PROJECT_UUID,
  sectionId: "intro",
};

const _minQaRunInsert: typeof qaRunsTable.$inferInsert = {
  brandId: BRAND_UUID,
  contentObjectId: CONTENT_UUID,
};

const _minQaCheckResultInsert: typeof qaCheckResultsTable.$inferInsert = {
  brandId: BRAND_UUID,
  qaRunId: QA_RUN_UUID,
  checkName: "originality.ai-score",
  severity: "hard",
  outcome: "pass",
};

const _minQaSignoffInsert: typeof qaSignoffsTable.$inferInsert = {
  brandId: BRAND_UUID,
  contentObjectId: CONTENT_UUID,
  reviewerId: USER_UUID,
  decision: "approved",
};

const _minQaOverrideInsert: typeof qaOverridesTable.$inferInsert = {
  brandId: BRAND_UUID,
  qaRunId: QA_RUN_UUID,
  checkName: "originality.ai-score",
  overriddenBy: USER_UUID,
  justification: "Client approved use of AI-generated content for this piece.",
};

const _minQaCheckDefInsert: typeof qaCheckDefinitionsTable.$inferInsert = {
  brandId: BRAND_UUID,
  checkName: "originality.ai-score",
  severity: "hard",
};

const _minRecoveryBaselineInsert: typeof recoveryBaselinesTable.$inferInsert = {
  brandId: BRAND_UUID,
  baselineDate: "2025-10-01",
  baselineAvgPosition: "18.4",
  baselineKeywordsInTop10: 42,
  baselineKeywordsInTop3: 11,
  lockedBy: "user_clerk_abc123",
};

const _minRecoveryInitiativeInsert: typeof recoveryInitiativesTable.$inferInsert = {
  brandId: BRAND_UUID,
  name: "Refresh 10 stale posts",
  type: "content_refresh",
  startedAt: new Date("2025-11-01"),
  createdBy: USER_UUID,
};

const _minRecoverySnapshotInsert: typeof recoverySnapshotsTable.$inferInsert = {
  brandId: BRAND_UUID,
  snapshotDate: "2025-11-15",
  avgPosition30d: "19.2",
  keywordsInTop10: 38,
  keywordsInTop3: 9,
};

// Nullable brand_id tables: minimal inserts confirm nothing required beyond table-specific fields.
const _minFetchedPageInsert: typeof fetchedPagesTable.$inferInsert = {
  url: "https://example.com/some-page",
  content: "<html>…page text…</html>",
};

const _minPlaybookInsert: typeof playbookTable.$inferInsert = {
  brandId: BRAND_UUID,
};

const _minPlaybookSectionInsert: typeof playbookSectionsTable.$inferInsert = {
  sectionNumber: 1,
  sectionTitle: "Introduction",
  sectionContent: "This is the introduction section of the playbook.",
  brandId: BRAND_UUID,
};

const _minVoiceLibraryInsert: typeof voiceLibraryTable.$inferInsert = {
  brandId: BRAND_UUID,
  originalAiText: "AI-generated draft sentence.",
  editedHumanText: "Human-edited version of that sentence.",
};

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Zod schema tests
// drizzle-zod's createInsertSchema mirrors the Drizzle column definitions:
//   - notNull() + no default  → required field
//   - nullable() or default() → optional field
// ─────────────────────────────────────────────────────────────────────────────

describe("schema smoke — brand_id is required in all brand-scoped tables", () => {
  const tables = [
    { name: "projects",             table: projectsTable },
    { name: "drafts",               table: draftsTable },
    { name: "research_briefs",      table: researchBriefsTable },
    { name: "content_objects",      table: contentObjectsTable },
    { name: "outlines",             table: outlinesTable },
    { name: "proof_points",         table: proofPointsTable },
    { name: "draft_scores",         table: draftScoresTable },
    { name: "interview_answers",    table: interviewAnswersTable },
    { name: "qa_runs",              table: qaRunsTable },
    { name: "qa_check_results",     table: qaCheckResultsTable },
    { name: "qa_signoffs",          table: qaSignoffsTable },
    { name: "qa_overrides",         table: qaOverridesTable },
    { name: "qa_check_definitions", table: qaCheckDefinitionsTable },
    { name: "recovery_baselines",   table: recoveryBaselinesTable },
    { name: "recovery_initiatives", table: recoveryInitiativesTable },
    { name: "recovery_snapshots",   table: recoverySnapshotsTable },
    { name: "voice_library",        table: voiceLibraryTable },
  ] as const;

  for (const { name, table } of tables) {
    it(`${name}: brand_id is required — insert without brand_id fails Zod`, () => {
      const zodSchema = createInsertSchema(table);
      const result = zodSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((e) => e.path.join("."));
        expect(paths).toContain("brandId");
      }
    });
  }
});

describe("schema smoke — minimal valid inserts parse successfully", () => {
  it("brands: slug + name is sufficient", () => {
    const zodSchema = createInsertSchema(brandsTable);
    const result = zodSchema.safeParse({ slug: "acme", name: "Acme Corp" });
    expect(result.success).toBe(true);
  });

  it("user_profiles: userId alone is sufficient", () => {
    const zodSchema = createInsertSchema(userProfilesTable);
    const result = zodSchema.safeParse({ userId: "user_clerk_abc123" });
    expect(result.success).toBe(true);
  });

  it("projects: brandId + topic + contentType is sufficient", () => {
    const zodSchema = createInsertSchema(projectsTable);
    const result = zodSchema.safeParse(_minProjectInsert);
    expect(result.success).toBe(true);
  });

  it("drafts: brandId + projectId + sectionId is sufficient", () => {
    const zodSchema = createInsertSchema(draftsTable);
    const result = zodSchema.safeParse(_minDraftInsert);
    expect(result.success).toBe(true);
  });

  it("research_briefs: brandId + projectId is sufficient", () => {
    const zodSchema = createInsertSchema(researchBriefsTable);
    const result = zodSchema.safeParse(_minResearchBriefInsert);
    expect(result.success).toBe(true);
  });

  it("content_objects: brandId + projectId is sufficient", () => {
    const zodSchema = createInsertSchema(contentObjectsTable);
    const result = zodSchema.safeParse(_minContentObjectInsert);
    expect(result.success).toBe(true);
  });

  it("outlines: brandId + projectId is sufficient", () => {
    const zodSchema = createInsertSchema(outlinesTable);
    const result = zodSchema.safeParse(_minOutlineInsert);
    expect(result.success).toBe(true);
  });

  it("proof_points: brandId + projectId + claim is sufficient", () => {
    const zodSchema = createInsertSchema(proofPointsTable);
    const result = zodSchema.safeParse(_minProofPointInsert);
    expect(result.success).toBe(true);
  });

  it("draft_scores: brandId + projectId is sufficient", () => {
    const zodSchema = createInsertSchema(draftScoresTable);
    const result = zodSchema.safeParse(_minDraftScoreInsert);
    expect(result.success).toBe(true);
  });

  it("interview_answers: brandId + projectId + sectionId is sufficient", () => {
    const zodSchema = createInsertSchema(interviewAnswersTable);
    const result = zodSchema.safeParse(_minInterviewAnswerInsert);
    expect(result.success).toBe(true);
  });

  it("qa_runs: brandId + contentObjectId is sufficient", () => {
    const zodSchema = createInsertSchema(qaRunsTable);
    const result = zodSchema.safeParse(_minQaRunInsert);
    expect(result.success).toBe(true);
  });

  it("qa_check_results: brandId + qaRunId + checkName + severity + outcome is sufficient", () => {
    const zodSchema = createInsertSchema(qaCheckResultsTable);
    const result = zodSchema.safeParse(_minQaCheckResultInsert);
    expect(result.success).toBe(true);
  });

  it("qa_signoffs: brandId + contentObjectId + reviewerId + decision is sufficient", () => {
    const zodSchema = createInsertSchema(qaSignoffsTable);
    const result = zodSchema.safeParse(_minQaSignoffInsert);
    expect(result.success).toBe(true);
  });

  it("qa_overrides: brandId + qaRunId + checkName + overriddenBy + justification is sufficient", () => {
    const zodSchema = createInsertSchema(qaOverridesTable);
    const result = zodSchema.safeParse(_minQaOverrideInsert);
    expect(result.success).toBe(true);
  });

  it("qa_check_definitions: brandId + checkName + severity is sufficient", () => {
    const zodSchema = createInsertSchema(qaCheckDefinitionsTable);
    const result = zodSchema.safeParse(_minQaCheckDefInsert);
    expect(result.success).toBe(true);
  });

  it("recovery_baselines: brandId + baselineDate + position fields + lockedBy is sufficient", () => {
    const zodSchema = createInsertSchema(recoveryBaselinesTable);
    const result = zodSchema.safeParse(_minRecoveryBaselineInsert);
    expect(result.success).toBe(true);
  });

  it("recovery_initiatives: brandId + name + type + startedAt + createdBy is sufficient", () => {
    const zodSchema = createInsertSchema(recoveryInitiativesTable);
    const result = zodSchema.safeParse(_minRecoveryInitiativeInsert);
    expect(result.success).toBe(true);
  });

  it("recovery_snapshots: brandId + snapshotDate + position fields is sufficient", () => {
    const zodSchema = createInsertSchema(recoverySnapshotsTable);
    const result = zodSchema.safeParse(_minRecoverySnapshotInsert);
    expect(result.success).toBe(true);
  });
});

describe("schema smoke — nullable brand_id tables correctly allow omitting brand_id", () => {
  it("events.brandId is optional (system-level events are cross-brand)", () => {
    const zodSchema = createInsertSchema(eventsTable);
    const result = zodSchema.safeParse({ eventType: "test.event" });
    expect(result.success).toBe(true);
  });

  it("audit_log.brandId is optional (admin actions may be cross-brand)", () => {
    const zodSchema = createInsertSchema(auditLogTable);
    const result = zodSchema.safeParse({ action: "admin.test", justification: "test run" });
    expect(result.success).toBe(true);
  });

  it("usage_logs.brandId is optional (cross-brand telemetry)", () => {
    const zodSchema = createInsertSchema(usageLogsTable);
    const result = zodSchema.safeParse({ model: "claude-3-5-sonnet" });
    expect(result.success).toBe(true);
  });

  it("integration_call_log.brandId is optional (system health pings)", () => {
    const zodSchema = createInsertSchema(integrationCallLogTable);
    const result = zodSchema.safeParse({
      vendor: "dataforseo",
      endpoint: "/v3/serp",
      status: "ok",
      durationMs: 250,
    });
    expect(result.success).toBe(true);
  });

  it("fetched_pages.brandId is optional; url and content are required", () => {
    const zodSchema = createInsertSchema(fetchedPagesTable);
    const withBrand = zodSchema.safeParse(_minFetchedPageInsert);
    expect(withBrand.success).toBe(true);
    const empty = zodSchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) {
      const paths = empty.error.issues.map((e) => e.path.join("."));
      expect(paths).toContain("url");
      expect(paths).toContain("content");
      expect(paths).not.toContain("brandId");
    }
  });

  it("playbook.brandId is required; minimal insert includes the owning brand", () => {
    const zodSchema = createInsertSchema(playbookTable);
    const result = zodSchema.safeParse(_minPlaybookInsert);
    expect(result.success).toBe(true);
    const emptyResult = zodSchema.safeParse({});
    expect(emptyResult.success).toBe(false);
    if (!emptyResult.success) {
      expect(emptyResult.error.issues.map((e) => e.path.join("."))).toContain("brandId");
    }
  });

  it("playbook_sections.brandId is required alongside section content", () => {
    const zodSchema = createInsertSchema(playbookSectionsTable);
    const result = zodSchema.safeParse(_minPlaybookSectionInsert);
    expect(result.success).toBe(true);
    const missingRequired = zodSchema.safeParse({});
    expect(missingRequired.success).toBe(false);
    if (!missingRequired.success) {
      const paths = missingRequired.error.issues.map((e) => e.path.join("."));
      expect(paths).toContain("sectionNumber");
      expect(paths).toContain("sectionTitle");
      expect(paths).toContain("sectionContent");
      expect(paths).toContain("brandId");
    }
  });

  it("voice_library.brandId, originalAiText, editedHumanText are required", () => {
    const zodSchema = createInsertSchema(voiceLibraryTable);
    const result = zodSchema.safeParse(_minVoiceLibraryInsert);
    expect(result.success).toBe(true);
    const empty = zodSchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) {
      const paths = empty.error.issues.map((e) => e.path.join("."));
      expect(paths).toContain("brandId");
      expect(paths).toContain("originalAiText");
      expect(paths).toContain("editedHumanText");
    }
  });
});
