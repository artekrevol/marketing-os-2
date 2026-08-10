---
name: worker-log-visibility
description: Pino JSON logs from the BullMQ worker are NOT visible in the Replit workflow log viewer — manual run with 2>&1 is required to see them.
---

# Worker log visibility in Replit

## The rule
The BullMQ worker (`lib/worker: BullMQ Worker` workflow) produces pino JSON structured logs, but they are invisible in the Replit workflow log viewer. The viewer only shows the raw process metadata line (`tsx src/index.ts`). No job completions, no cron registrations, no handler output appears in the UI.

**Why:** Pino writes JSON to stdout; the Replit workflow log capture strips or doesn't forward structured JSON lines — only plain text appears.

**How to see actual worker logs:** Run the worker manually in the shell:
```bash
timeout 15 pnpm --filter @workspace/worker exec tsx src/index.ts 2>&1 | head -50
```
This captures both stdout and stderr and shows all pino output.

## Consequence
This is the monitoring gap that allowed the cron pipeline to appear "broken" for 80+ days. The worker was functional (registrations succeeded, Redis connected), but nobody could see log output to verify it was running jobs.

## Cron-alive verification
The `maintenance.heartbeat-noop` repeatable at `*/5 * * * *` is registered (as of 2026-08-10). To verify cron is firing, query:
```sql
SELECT created_at, payload FROM events
WHERE event_type = 'system.heartbeat'
ORDER BY created_at DESC LIMIT 5;
```
Each fire writes one row (first fire only due to idempotency, but the job: started log line fires every time).

## Discovery-weekly registration confirmed
All 4 brands (TekRevol, ClaimShield, Reverto, CensusFlow) have `seo.discovery.weekly` registered at `0 2 * * 1` (Monday 02:00 UTC) in the standalone worker. Embedded worker does NOT register it — only standalone index.ts does. The dev workflow uses standalone (tsx src/index.ts).
