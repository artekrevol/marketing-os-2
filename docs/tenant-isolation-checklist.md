# Tenant isolation checklist

Use this checklist for every new ContentForge, SEO OS, integration, or
background-job module. A frontend-selected brand is input, never proof of
authorization.

## Request boundary

- Resolve the authenticated actor, role, correlation ID, and authorized
  `brandId` at the request boundary.
- Use `guardBrand`, `assertBrandAccess`, or
  `assertBrandAccessForProject`; do not authorize from local storage, query
  keys, or a client-provided role.
- Every resource lookup, update, delete, export, and enqueue filters by both
  resource ID and the resolved brand.
- Cross-module IDs (project, location, keyword, content object, integration)
  are independently checked before calling a helper.
- OAuth state is short-lived, single-use, bound to the initiating user and
  brand, and the callback requires authentication.

## Data boundary

- Tenant records have a required `brand_id` foreign key.
- A child record that references another tenant record uses a same-brand
  composite foreign key (or an equivalent transaction-level invariant).
- Nullable ownership is permitted only for explicitly documented system
  telemetry; it must not be used for user-visible data or caches.
- Raw SQL includes the brand predicate for reads and mutations.
- Exports and object-storage keys include the brand identity and validate
  stored object names before reading them.

## Worker boundary

- Tenant job payloads extend the required `BrandPayload`.
- Brandless payloads are limited to explicitly named system orchestrators and
  diagnostics.
- Handlers validate every referenced row under `withBrandScope` before paid
  API work or status mutation.
- Job identity and idempotency keys include the tenant when the job is
  tenant-owned.
- Retries, dead-job records, and terminal events preserve the brand context.

## Client/cache boundary

- Query keys include brand and configuration/playbook version where relevant.
- Local storage is treated as a hint only; server authorization remains
  authoritative.
- Browser uploads, temporary files, generated exports, and cache entries are
  scoped to the authorized brand.
- A missing or mismatched brand fails closed; it never falls back to “latest”
  or “all brands”.

## Two-brand verification matrix

For fixtures Brand A, Brand B, and an actor authorized only for Brand A, verify:

| Surface | Brand A | Brand B ID supplied to A |
| --- | --- | --- |
| API read/list | returns only A | 403/404 and no rows |
| API update/delete/export | changes A only | rejected and B unchanged |
| Cross-module parent/child lookup | accepts matching A IDs | rejects mismatched IDs |
| OAuth start/callback/refresh/disconnect | operates on A | rejects B state/connection |
| Worker enqueue | accepts A payload | schema/authorization rejects B |
| Worker referenced row | processes A | fails before mutation or paid call |
| Cache/object/export read | resolves A prefix/key | cannot resolve B prefix/key |
| Retry/dead-job/event attribution | retains A context | never reassigns to B |

Run the matrix for success, duplicate/idempotent retry, missing-resource,
expired OAuth state, malformed payload, upstream timeout, and partial-failure
paths. Add the fixture to the module's automated tests before exposing it.