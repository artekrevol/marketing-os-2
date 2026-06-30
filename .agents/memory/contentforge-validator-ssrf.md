---
name: ContentForge validator URL-fetch SSRF guard
description: Why the validator fetchUrl must enforce a public-IP allowlist on every hop.
---

# Validator URL-fetch SSRF guard

The Phase 6.3 stat-verification validator fetches `source_url` values that come
from MODEL-EXTRACTED article schema (untrusted). The api-server `buildValidatorDeps.fetchUrl`
must therefore:
- accept only `http:`/`https:` URLs;
- reject `localhost`, `*.localhost`, `*.internal`, `*.local`, and any hostname that
  resolves (DNS) to a private/loopback/link-local/unique-local/CGNAT address —
  including the cloud metadata IP 169.254.169.254;
- follow redirects MANUALLY and re-validate every hop (a public URL can 30x-redirect
  to an internal host).

**Why:** an architect review flagged unrestricted server-side `fetch()` on
model-supplied URLs as a serious SSRF vector (internal network / metadata probing).

**How to apply:** if any new server code fetches a URL that originated from model
output or user input, route it through the same `isSafePublicUrl` guard rather than
calling `fetch()` directly.
