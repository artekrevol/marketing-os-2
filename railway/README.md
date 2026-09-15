# Railway service configs

These files aren't picked up automatically — a `railway.json` at the repo
root is the only path Railway reads by default. Each service here needs its
**Settings → Config-as-code path** set explicitly (in the Railway dashboard,
not from a file) to the matching path below:

| Service | Config-as-code path | Type |
|---|---|---|
| `api` | `railway/api.json` | Web service (public domain) |
| `worker` | `railway/worker.json` | Background worker |
| `cron-discovery` | `railway/cron-discovery.json` | Cron job, Mondays 02:00 UTC |
| `cron-nightly` | `railway/cron-nightly.json` | Cron job, daily 03:00 UTC (recovery snapshot + content-context refresh) |
| `cron-gsc` | `railway/cron-gsc.json` | Cron job, daily 04:00 UTC |

All five app services should have their **root directory** left at the repo
root (`/`) — this is a pnpm workspace and every build command filters to the
right package from there.

`worker` and `api` both build `@workspace/worker` because the API server
bundles `@workspace/worker/embedded` even though `EMBED_WORKERS` is expected
to stay off in this topology (see `artifacts/api-server/src/index.ts`). Set
`EMBED_WORKERS=false` explicitly on `api` so an unset Railway env var can
never fall back to "on".

See the deployment plan in chat / `docs/` for the full environment variable
list per service, the Postgres/Redis provisioning, and the one-time
`pnpm --filter @workspace/db run push` step required before the API's first
boot against a fresh database.
