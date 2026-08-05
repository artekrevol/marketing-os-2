---
name: brief-compliance schema gap
description: The brief-compliance QA check was written against a draft.metadata column that was never added to the schema.
---

The `brief-compliance.ts` QA check was designed to read `metaTitle`, `metaDescription`, and `targetWordCount` from a `draft.metadata` JSONB column that was planned but never added to `draftsTable`. As a result, all three sub-checks were always skipped.

**Fix applied:** Rewrote `loadDraftMeta` to query `outlines.meta_description` (the only schema-backed SEO metadata source) for the metaDescription sub-check. `metaTitle` and `targetWordCount` remain skipped (no schema source).

**Why:** The `draftsTable` columns are: id, brandId, projectId, sectionId, sectionHeading, content, approved, voiceMatchScore, voiceFlags, dismissedVoiceFlags, reviewQuestions, citationCount, revisionCount, aiCitationReadinessScore, atomicChunksCount, entityDensityScore, schemaMarkupRecommendations, lastEditedBy, createdAt, updatedAt. No metadata column.

**How to apply:** If `metaTitle` or `targetWordCount` are ever added to the schema (outlines or projects table), update `loadDraftMeta` in `lib/worker/src/jobs/content/checks/brief-compliance.ts` to read them.
