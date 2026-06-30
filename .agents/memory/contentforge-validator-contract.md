---
name: ContentForge validator purity & strip contract
description: The non-mutation + strip-application contract that runAllValidators must honor.
---

# Validator purity & strip-application contract

`runAllValidators(ctx)` (lib/content-ai/src/validators) must:
1. NOT mutate the caller's input article. It deep-clones (`structuredClone`) the
   article and runs every check against the clone.
2. Apply HARD strips to the clone before returning — items a HARD check reports in
   `stripped[]` are removed from the corresponding article arrays
   (statistics_used, testimonials_used, internal_links, case_studies_cited,
   external_authority_citations) by object identity.
3. Return `sanitizedArticle` on the summary. The final-stitch route persists
   `result.sanitizedArticle` as `draft_scores.article_schema`, NOT the raw extract.

**Why:** an architect review found validators were mutating `ctx.article`
(verified_live / flagged_as_stale) and that strips were metadata-only — failing
items still shipped in the persisted schema. The dispatch explicitly requires
validators to be pure and the persisted schema to be the sanitized one.

**How to apply:**
- For strip-by-identity to work, a HARD validator's `stripped[].value` MUST be the
  actual array element object (not a string like project_name). `caseStudyNarrative`
  must push `value: cs` (the object).
- SOFT checks (e.g. staleStats) only flag inline; they must never remove items.
- Every strip still emits a `module_data_provenance` row (reason
  'validator-stripped') in the final-stitch route.
