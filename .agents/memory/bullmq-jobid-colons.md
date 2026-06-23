---
name: BullMQ custom jobId colon constraint
description: Why idempotencyKey strings must contain exactly one colon in this repo's enqueue() path.
---

# BullMQ custom jobId colon constraint

`enqueue()` (lib/jobs) builds the BullMQ custom job id as `${name}:${idempotencyKey}`.

**Rule:** BullMQ (>=5, observed on 5.76.4) rejects a custom job id that contains
`:` unless it splits into exactly 3 parts. Its internal check is
`jobId.includes(":") && jobId.split(":").length !== 3 → throw "Custom Id cannot contain :"`.
Because job names contain no colons and `enqueue()` always prefixes with
`${name}:`, the **idempotencyKey must contain exactly one colon** — no more, no
fewer. A colon-free key produces a 2-part id (also rejected); a key with a
`:${Date.now()}` suffix produces a 4-part id (rejected).

**Why:** Surfaced when competitor-discover / competitor-insights routes used
`<prefix>:${brandId}:${Date.now()}` (2 colons → 4-part id) and threw a 500 at
enqueue. The crawl route worked only because `seo-crawl:${batchId}` has exactly
one colon. The error is opaque ("Custom Id cannot contain :"), so it is easy to
misdiagnose as "no colons allowed" when the truth is "exactly one colon".

**How to apply:** When writing a new `idempotencyKey`, keep it `prefix:id`. For
uniqueness suffixes use a non-colon separator: `prefix:${id}-${Date.now()}`.
`buildJobId()` in lib/jobs/src/enqueue.ts now validates this and throws an
actionable message naming the offending id. The worker treats `idempotencyKey`
as opaque (dedup + event storage), so the separator choice does not affect
dedup. Known stragglers still on the bad pattern: AI routes
`research-generate` / `research-retry-card`, and `recovery-snapshot` jobs.
