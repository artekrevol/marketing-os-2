---
name: Cross-module brand isolation
description: Why cross-module writes must re-verify foreign-key ownership against the active brand scope.
---

# Cross-module writes must verify FK ownership against the brand scope

In the Shared Data Layer, ContentForge and SEO OS reference each other by **raw
UUID foreign keys** — `projectId`, `target_location_id`, `locationId`,
`keywordId`. These columns are NOT enforced by `withBrandScope`/`scoped.*`
unless you actively read the referenced row through `scoped.select`.

**Rule:** before any cross-module write that accepts a foreign UUID from the
client (attach keyword to project, track keyword, set a project's target
location), re-read the referenced row via `scoped.select(table, {where eq(id)})`
(or `assertLocationInBrand`-style helper in route code) and reject (404 /
"not found in this brand") when it's absent. `scoped` filters by `brand_id`, so
a row owned by another brand simply isn't found.

**Why:** the DB FKs are by raw UUID with no brand predicate, so without the
explicit ownership check a caller can bind another tenant's project/location to
their own records — a cross-tenant data leak. A prior architect review flagged
this as CRITICAL.

**How to apply:** any new `/api/cross-module/*` write, or any `projects`
create/patch that accepts `target_location_id`, must do the ownership check
before the insert/update. Do the check and the write in the SAME
`withBrandScope` transaction when atomicity matters (e.g. canonical demotion +
re-attach — pass `demoteExistingCanonical` into `attachKeywordToContent` rather
than demoting in a separate transaction, or a failure leaves the project with
no canonical link).
