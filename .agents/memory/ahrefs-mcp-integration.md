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
- `tool_choice: { type: "tool", name: "submit_draft" }` prevents model from calling Ahrefs tools
- draft-section toolContext is a no-op currently (forced-tool constraint); real value is in final-stitch repetition-rewrite pass (free tool choice)
- Pre-pass approach for draft-section (run Ahrefs pass before forced draft call) is a future enhancement

## Sentinel UUID
- `module_data_provenance.entity_id` is uuid NOT NULL
- Use `'00000000-0000-0000-0000-000000000000'` when projectId is null/invalid

## Package structure
- `lib/integrations/ahrefs` — AhrefsMCPClient, exported types
- `lib/content-ai/src/tools/ahrefs/cache.ts` — cache helpers (getDomainAuthority, getBacklinkSummary, getKeywordData, logAhrefsUsage)
- `lib/content-ai/src/tools/ahrefs/definitions.ts` — AHREFS_TOOL_DEFINITIONS, AHREFS_TOOL_NAME_SET (typed Set<string>), AHREFS_SYSTEM_ADDENDUM
- `lib/content-ai/src/tools/ahrefs/handler.ts` — executeAhrefsTool
- All exported from @workspace/content-ai
