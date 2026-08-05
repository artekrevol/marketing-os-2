---
name: ContentType enum migration
description: The content-type enum was refactored from 4 old values to 8 new ones; several callers were not updated.
---

The DB CHECK constraint on `projects.content_type` was updated to allow only:
`cost_guide | comparison_guide | how_to_guide | statistics_trends | explainer | case_study | vertical_deep_dive | thought_leadership`

The old values `blog`, `landing`, `service` are rejected. Only `case_study` overlaps.

**Callers that were updated (this session):**
- `lib/db/src/schema/projects.ts` — DB constraint (was already done pre-session)
- `artifacts/insight-forge/src/lib/types.ts` — `ContentType` TypeScript type
- `artifacts/insight-forge/src/pages/BriefProposal.tsx` — dropdown options, default state, fallback
- `lib/worker/src/jobs/ai/propose-brief.ts` — tool schema enum + system prompt default

**Why:** When the DB constraint was updated, frontend types and AI tool schema were not updated. This caused HTTP 500 on project creation and brief confirmation for any content type other than case_study.

**How to apply:** Any new code that accepts or produces a content_type must use the 8-value list above. The TypeScript type is in `artifacts/insight-forge/src/lib/types.ts`.
