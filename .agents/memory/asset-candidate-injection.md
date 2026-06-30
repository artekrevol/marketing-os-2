---
name: Asset-candidate injection determinism (ContentForge AI)
description: Why injected candidate blocks must be byte-deterministic, and the matrix N/A-precondition pattern.
---

# Candidate injection must be byte-identical across a project's calls

The draft-section route injects an "approved asset candidates" block into the
**cached** projectContext. Anthropic prompt caching keys on the literal prompt
prefix, so the block must be byte-identical across every section call of one
project or every section busts the cache.

**Why:** `findTestimonials` / `findLinkTargets` (lib/db) apply `LIMIT` ordered by
`lastVerifiedAt`. With tied timestamps the LIMITed subset is non-deterministic,
so sorting by `id` *after* the limit cannot recover a stable set.

**How to apply:** determinism needs BOTH ends — a stable DB order (`lastVerifiedAt`
THEN `id` tiebreak in the helpers) AND a sort-by-id before formatting in the
caller. Keep both.

# Matrix N/A-when-precondition-absent pattern

Regression-matrix check #19 (LSI coverage) returns **N/A** when
`article_schema.lsi_retrieved` is empty — same "precondition not met" semantic
as the SERP-driven table checks 6–9 (`requires_*` signal absent). Encoded via
`naIfEmptyField` on the KEY_MAP entry + a gate before the generic pass/fail
branch. `article_schema.lsi_retrieved` mirrors `project.lsiRetrieved`; when
research retrieved no LSI terms, coverage has no denominator, so 0% is a
non-applicable result, not a content failure.
