/**
 * One-shot commands used by Replit Scheduled Deployments.
 *
 * Each command only dispatches a small BullMQ fan-out job to the long-running
 * VM worker, then exits. This keeps fixed calendar schedules out of the VM
 * boot path while preserving the existing retrying handlers.
 */
import { brandsTable, closeDb, guardedDb } from "@workspace/db";
import { closeRedisConnection, enqueue } from "@workspace/jobs";

type Kind = "gsc" | "recovery" | "content-context" | "discovery";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

async function dispatch(kind: Kind): Promise<void> {
  const today = isoDate(new Date());
  if (kind === "gsc") {
    await enqueue("seo.sync-gsc.nightly", {
      idempotencyKey: `seo-sync-gsc-nightly:${today}`,
    });
    return;
  }
  if (kind === "recovery") {
    await enqueue("scoring.recovery-snapshot-nightly", {
      idempotencyKey: `recovery-snapshot-nightly:${today}`,
    });
    return;
  }
  if (kind === "content-context") {
    await enqueue("seo.refresh-content-context-nightly", {
      idempotencyKey: `refresh-content-context-nightly:${today}`,
    });
    return;
  }

  const weekLabel = isoWeek(new Date());
  const brands = (await guardedDb
    .select({ id: brandsTable.id })
    .from(brandsTable)) as Array<{ id: string }>;
  for (const { id: brandId } of brands) {
    await enqueue("seo.discovery.weekly", {
      brandId,
      weekLabel,
      maxKd: 70,
      seedLimit: 20,
      relatedLimit: 500,
      competitorRankedLimit: 200,
      idempotencyKey: `discovery-weekly:${brandId}-${weekLabel}`,
    });
  }
}

const kind = process.argv[2] as Kind | undefined;
if (!kind || !["gsc", "recovery", "content-context", "discovery"].includes(kind)) {
  console.error("Usage: scheduled:dispatch -- <gsc|recovery|content-context|discovery>");
  process.exitCode = 1;
} else {
  dispatch(kind)
    .then(() => {
      console.log(`scheduled-dispatch: ${kind} dispatched`);
    })
    .catch((error) => {
      console.error(`scheduled-dispatch: ${kind} failed`, error);
      process.exitCode = 1;
    })
    .finally(() =>
      Promise.all([
        closeRedisConnection().catch(() => undefined),
        closeDb().catch(() => undefined),
      ]),
    );
}