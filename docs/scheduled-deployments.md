# Fixed scheduled jobs

The API/worker VM remains the long-running BullMQ consumer. Fixed calendar work
is dispatched by short-lived Replit Scheduled Deployments so a worker restart
does not decide whether a calendar tick happened.

Create these Scheduled Deployments with the commands below. All times are UTC.
Each command exits after it has enqueued the existing retrying handler.

| Job | Schedule | Run command |
| --- | --- | --- |
| GSC daily sync | `0 4 * * *` | `pnpm --filter @workspace/worker run scheduled:dispatch -- gsc` |
| Recovery snapshots | `0 3 * * *` | `pnpm --filter @workspace/worker run scheduled:dispatch -- recovery` |
| Content-context refresh | `0 3 * * *` | `pnpm --filter @workspace/worker run scheduled:dispatch -- content-context` |
| Discovery Engine | `0 2 * * 1` | `pnpm --filter @workspace/worker run scheduled:dispatch -- discovery` |

The GSC command fans out one seven-day-overlap sync per connected brand. The
Google Integrations page reports this cadence and the next 04:00 UTC run.

## One-shot GSC backfill

Run the backfill as a separate production Scheduled Deployment or one-shot
operator command:

```text
pnpm --filter @workspace/worker run gsc:backfill -- <brandId> <dateFrom> <dateTo>
```

It requires `NODE_ENV=production`, splits the range into calendar-month
chunks, records one `gsc_sync_log` row per chunk, skips completed chunks on
rerun, and retries errored or interrupted chunks. Do not use a development
workspace shell to backfill production data.

## Deferred scheduling work

Dynamic per-brand crawl schedules remain BullMQ repeatables reconciled from
`crawl_schedules`. Delayed Recovery work remains BullMQ delayed jobs. Moving
either to a static Scheduled Deployment requires a DB-backed due-work
dispatcher so each due row can be claimed, retried, and audited without
creating one deployment per user schedule.