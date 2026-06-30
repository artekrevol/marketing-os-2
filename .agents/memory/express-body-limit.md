---
name: Express JSON body limit for asset imports
description: Why the API server raises express.json limit above the 100KB default
---

# Express JSON body limit

The api-server (`artifacts/api-server/src/app.ts`) sets `express.json({ limit: "2mb" })`
(and the same on `urlencoded`) rather than the Express default (~100KB).

**Why:** Admin asset-import endpoints (`POST /api/admin/reviews-bank/import`,
`POST /api/admin/link-targets/import`) accept whole canonical corpus files. The
reviews bank JSON alone is ~285KB, and xlsx-as-base64 payloads inflate further.
The default 100KB limit silently rejects these with 413 before route logic runs.

**How to apply:** Any new endpoint that ingests a full uploaded file (JSON dump,
base64-encoded spreadsheet, etc.) must stay under the 2mb global limit, or the
limit must be raised. If a future corpus exceeds ~2mb, prefer a route-scoped
larger limit on the import routes over raising the global ceiling.
