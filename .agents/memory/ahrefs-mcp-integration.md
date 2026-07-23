---
name: Ahrefs MCP Integration
description: Architecture decisions and constraints for the Ahrefs MCP integration in lib/content-ai and lib/integrations/ahrefs
---

# Ahrefs MCP Integration

## MCP transport
- Endpoint: `https://api.ahrefs.com/mcp/mcp` (Streamable HTTP, NOT SSE)
- Auth: `Authorization: Bearer $AHREFS_MCP_KEY`
- Do NOT use `/mcp/mcpSse` — Ahrefs discontinued SSE transport

## Tool names (confirmed live)
- `site-explorer-domain-rating` — requires: target, date (YYYY-MM-DD)
- `site-explorer-backlinks-stats` — requires: target, date; optional: mode, protocol
- `keywords-explorer-overview` — requires: select, country; field name is `difficulty` NOT `keyword_difficulty`

## Response shapes
- DR → `{ domain_rating: { domain_rating: 93.0 } }`
- Backlinks → `{ metrics: { live, all_time, live_refdomains, all_time_refdomains } }`
- Keywords → `{ keywords: [{ volume, difficulty, cpc, parent_topic, keyword }] }`

## Budget
- 400,000 units/month; 11,413 used before integration (as of 2026-07-23). Reset: 2026-08-19.

## Tool loop constraint (IMPORTANT)
- `callAnthropicRaw` in api-server/routes/ai/index.ts only intercepts Ahrefs `tool_use` blocks
- Non-Ahrefs tool_use blocks (submit_draft, submit_article_schema) are TERMINAL — loop returns immediately
- `tool_choice: { type: "tool", name: "submit_draft" }` prevents model from calling Ahrefs tools in the main draft call
- `ahrefsBudget` option on `callAnthropicRaw` makes the per-call cap configurable (default 5)

## Phase 6 — Ahrefs pre-pass for draft-section
- `runAhrefsPrePass` runs BEFORE the forced-tool draft call — HAIKU, budget 3, no forced tool_choice
- Runs concurrently with `buildAssetCandidates` via `Promise.all` — zero added latency when AHREFS_MCP_KEY absent
- Seed domains come from `whitelist.sources.slice(0,5)` (already URL-normalized)
- Result injected as `AHREFS_RESEARCH_CONTEXT` block in `projectContext` string (inside `buildRoutedSystemWithProject` system)
- Skipped entirely when `revision_instruction` is present — revisions refine prose, not citations
- Non-blocking: catches all errors, returns null (never throws)
- Budget split per section: 3 calls pre-pass + up to 5 calls repetition-rewrite (independent invocations)

## Sentinel UUID
- `module_data_provenance.entity_id` is uuid NOT NULL
- Use `'00000000-0000-0000-0000-000000000000'` when projectId is null/invalid

## Package structure
- `lib/integrations/ahrefs` — AhrefsMCPClient, exported types
- `lib/content-ai/src/tools/ahrefs/cache.ts` — cache helpers (getDomainAuthority, getBacklinkSummary, getKeywordData, logAhrefsUsage)
- `lib/content-ai/src/tools/ahrefs/definitions.ts` — AHREFS_TOOL_DEFINITIONS, AHREFS_TOOL_NAME_SET (typed Set<string>), AHREFS_SYSTEM_ADDENDUM
- `lib/content-ai/src/tools/ahrefs/handler.ts` — executeAhrefsTool
- All exported from @workspace/content-ai
