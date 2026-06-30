---
name: ContentForge case-study money suppression
description: Why case_studies_cited must never carry a contract/dollar value, and the defense-in-depth that enforces it.
---

# Case studies: "what we built, not what we billed"

A cited case study in ContentForge articles must NEVER expose a per-project
contract value or any dollar figure. This is the highest-priority architectural
rule of the Quality Fix Dispatch (Phase 5.9 / 6.6).

**Why:** the contract value is commercially confidential and legally sensitive;
once a dollar amount reaches a published article it cannot be retracted. The
client treats this as a hard ship-blocker, not a style preference.

**How to apply (defense in depth — keep all layers):**
1. Schema layer — the article extraction tool (`ARTICLE_TOOL`,
   `submit_article_schema`) intentionally omits `contract_value` from
   `case_studies_cited.items` and sets `additionalProperties:false`, so the model
   cannot emit it.
2. Sanitizer — `sanitizeArticleSchema` whitelists case-study fields and strips
   known money keys.
3. Validator — `caseStudyNarrative` (lib/content-ai validators) re-asserts: any
   money key on the object OR a `$`-amount in narrative/outcome strips the entry;
   `project_name` must exist in the playbook portfolio OR reviews bank.

If you add a new path that builds/persists case studies, it must pass through all
three layers. Never reintroduce a money field "just for internal use".
