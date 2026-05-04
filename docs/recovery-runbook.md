# Recovery War Room — Runbook

Operational guide for the Recovery War Room dashboard. Covers
interpretation, baseline management, initiative tracking, and PDF
export.

## Dashboard interpretation

### Headline gauge

The big number on the headline card is the **current 30-day average
position** across all tracked keywords for the selected brand.

- **Green** (gauge): current avg position ≤ baseline → recovered or
  better than pre-October levels.
- **Yellow**: gap of 0–3 positions worse than baseline → closing in.
- **Red**: gap >3 positions worse → significant ground to recover.

The delta line reads: `11.1 (was 8.4, gap +2.7)` — meaning current
avg position is 11.1, baseline was 8.4, and the brand is 2.7 positions
worse.

### Sub-metrics

- **Top-10 keywords**: count of keywords ranking in positions 1–10,
  with delta vs baseline.
- **Top-3 keywords**: count of keywords ranking in positions 1–3,
  with delta vs baseline.
- **GSC clicks**: placeholder — reads `"— (pending GSC ingestion)"`
  until the GSC analytics pipeline ships.

### 90-day trend chart

- **Red line**: `gap_to_baseline_top10_pct` — percentage gap vs
  baseline top-10 keyword count. Below zero = worse than baseline.
- **Green reference line at 0%**: the baseline. Crossing above = full
  recovery.
- **Dashed continuation**: projected trajectory based on linear
  regression of the last 30 snapshots.
- **Blue markers**: initiative start dates, so you can correlate
  recovery actions with trend inflections.

### Projection card

- **Projected recovery date**: when the linear regression projects the
  gap will hit zero. Only shown when the gap is closing (positive slope).
- **"Gap widening"**: the trend is flat or worsening — no convergence
  date can be projected.
- **"Insufficient data"**: fewer than 7 snapshots with non-null gap
  data; wait for more nightly snapshots.

## Baseline management

### What a baseline is

A locked set of pre-October 2025 metrics for a single brand: avg
position, top-10 count, top-3 count (from `rank_snapshots`), plus
nullable GSC clicks and GA4 sessions fields for future use.

### When to lock

Lock baselines once during initial setup. The lock-baselines script
(`pnpm --filter @workspace/services-recovery run lock-baselines`)
defaults to dry-run mode. Review the output in
`docs/recovery-baseline-dry-run.md`, then re-run with `--confirm` to
commit.

### Locking rules

- One baseline per brand (enforced by unique constraint).
- Re-running the lock script on an already-locked brand is a no-op.
- Baseline override requires an admin path (deferred to Wave 2).
- Every lock writes to `audit_log` with action
  `recovery.baseline_locked`.

### NULL baselines

ClaimShield and CensusFlow may have NULL or zero baseline values if
no `rank_snapshots` data exists for their baseline date. This is
expected and documented in `docs/recovery-baselines.md`. The dashboard
handles NULLs gracefully — metrics display "—" and the projection
reports "Insufficient data".

## Initiative tracking

### What an initiative is

A manually logged recovery action (content refresh, content kill,
technical fix, link building, etc.) with expected impact and status
tracking.

### Logging initiatives

1. Navigate to `/recovery` and select a brand.
2. Click **Log initiative** in the initiatives ribbon.
3. Fill in name (5–100 chars), type, description, expected impact %,
   and start date.
4. Initiatives appear on the trend chart as blue markers at their
   start date.

### Completing initiatives

1. Click an initiative card to open the detail modal.
2. Click **Mark complete** and optionally add completion notes.
3. The initiative moves to "completed" status.

### Abandoning initiatives

Admin-only. Click **Abandon** in the detail modal, provide a required
reason. The initiative moves to "abandoned" status.

### Role requirements

- **Create / Edit / Complete**: admin or editor with brand access.
- **Abandon**: admin only.

## PDF export

### Single-brand export

1. Navigate to `/recovery`, select a brand.
2. Click **Export PDF** in the header (admin-only button).
3. A one-page PDF downloads with: branded header, four-metric row,
   90-day trend chart (SVG), top 3 active initiatives, projected
   recovery date, page-numbered footer.

### All-brands export

`GET /api/recovery/export/all.pdf` (admin-only, requires auth token).
Concatenates one page per brand into a single document. Useful for
board packets.

### Performance

PDF generation targets <10 seconds for a single brand. The all-brands
variant runs brand data fetches in parallel to minimize wall-clock
time.

## Nightly snapshots

- Cron: `0 3 * * *` UTC via BullMQ repeatable job.
- Fan-out: one `scoring.recovery-snapshot` job per brand with a locked
  baseline.
- Idempotent: re-runs for the same brand + date are no-ops (unique
  index + BullMQ jobId dedup).
- Backfill: `pnpm --filter @workspace/worker exec tsx src/scripts/backfill-recovery-snapshots.ts`

## When to mark recovery complete

Recovery is complete when the 30-day rolling average of the headline
metric returns to (or exceeds) the baseline level for 60 consecutive
days. The dashboard will show a "Recovered" status on the projection
card. At that point:

1. Ensure all active initiatives are marked completed or abandoned.
2. Export a final PDF for the board record.
3. The Recovery War Room service can be retired — its 12–18 month
   lifespan is by design.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Baseline not yet locked" | No baseline row for brand | Run lock-baselines script |
| "Snapshots not yet computed" | Nightly job hasn't run yet | Wait 24h or run backfill script |
| All metrics show "—" | No rank_snapshots data for brand | Check DataForSEO integration |
| PDF returns 403 | Caller is not admin | Only admins can export PDFs |
| PDF returns 500 | Service-layer error | Check api-server logs (`req.log.error`) |
