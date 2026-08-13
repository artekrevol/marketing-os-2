---
name: authedFetch FormData Content-Type bug
description: authedFetch sets Content-Type application/json for ALL bodies including FormData, causing express.json() to intercept file uploads before multer sees them.
---

## The rule
`authedFetch` must NOT set `Content-Type: application/json` when `init.body instanceof FormData`.
The browser sets the correct `multipart/form-data; boundary=...` automatically only when no Content-Type is present.

**Why:** If Content-Type is forced to `application/json` on a FormData body:
- `express.json()` middleware intercepts the raw multipart stream (it checks Content-Type, not actual body format)
- With large files → `PayloadTooLargeError` (body-parser's 2MB JSON limit) → **413**
- With small files → `SyntaxError: Unexpected token '-'` (multipart boundary `------geck...` is not valid JSON) → **400**
- Multer never sees `req.files`; route returns "No files provided"

**How to apply:** The fix is already in `artifacts/seo-os/src/lib/api.ts`:
```typescript
if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
  headers.set("Content-Type", "application/json");
}
```
Any future fetch wrapper or helper that auto-sets Content-Type must include the same FormData guard.
