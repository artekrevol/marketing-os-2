---
name: Citation whitelist enforcement vs validators (ContentForge AI)
description: Why asset citations get silently stripped before validation, and the two-layer model behind it.
---

# Two separate citation-stripping layers in the AI pipeline

There are **two** independent places a link/citation can be removed in the
ContentForge generation pipeline, and they are easy to confuse:

1. **`enforceCitationWhitelist(content, hosts)`** — a *generation-side* strip in
   the draft-section route. It rewrites any `[label](http…)` whose normalized
   host is not in `whitelist.hosts` down to plain `label`. This runs BEFORE the
   draft is ever scored.
2. **The validators** (`@workspace/content-ai`) — the *verification floor*
   (`all_links_in_link_targets`, `authority_floor_passes`,
   `all_stats_verified_live`, …). These run at final-stitch.

**Why:** the whitelist is built from project proofs + company domain only. So
even when the model correctly cites an approved authority domain or an internal
link target, layer (1) strips it before layer (2) ever sees it — manifesting as
authority=0 / internal_links=0 with no validator failure to explain it.

**How to apply:** any NEW legitimate citation source must be added to
`whitelist.hosts` in the draft route, or it gets stripped pre-validation.
Cut A adds `AUTHORITY_WHITELIST` domains + candidate link-target hosts there.
`normalizeUrl` strips `www.` and lowercases, so adding the bare host
(`statista.com`) matches `https://www.statista.com/deep/link`. This is NOT a
validator change — the verification floor stays untouched.
