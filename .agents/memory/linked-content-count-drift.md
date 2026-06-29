---
name: linked_content_count drift
description: Why the denormalized keyword→content link counter can drift and how it is kept honest.
---

# `keywords.linked_content_count` is increment-only → reconcile nightly

`keywords.linked_content_count` is a denormalized counter incremented by
`attachKeywordToContent` whenever a new `content_url_keyword_link` row is
created. There is **no in-app unlink path**, so the only way the counter drifts
from reality is an out-of-band delete — e.g. a `projects` hard-delete cascading
its link rows without touching the counter.

**Rule:** the authoritative count is `COUNT(content_url_keyword_link)` grouped
by keyword. `reconcileLinkedContentCounts(brandId)` recomputes the counter from
those rows and is wired into the nightly `seo.refresh-content-context-nightly`
fan-out (per brand, failure-isolated so one brand's failure doesn't abort the
rest).

**Why:** without reconciliation the UI overcounts linked articles after any
cascade delete, and there's no unlink path that would otherwise correct it.

**How to apply:** if you ever add an unlink/delete path, decrement the counter
there too — but keep the nightly reconcile as the safety net. The reconcile uses
raw `db.execute(sql\`...\`)` (the guarded-db escape hatch) with an explicit
`WHERE brand_id = ${brandId}` predicate, since `scoped.*` can't express the
GROUP BY join.
