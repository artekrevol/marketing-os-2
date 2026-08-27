import { guardedDb as db, eventsTable } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { DataForSEOClient } from "@workspace/integrations-dataforseo";
import type { Logger } from "pino";
import { assertNotDuplicate } from "./idempotency";

const SUCCESS_EVENT = "integration.dataforseo.test.ok";

export async function handleDataForSeoSerpTest(
  payload: JobData<"integrations.dataforseo-serp-test">,
  log: Logger,
): Promise<{ items: number; duplicate?: true }> {
  // Handler-level idempotency: short-circuit if a prior success event
  // for this idempotencyKey already exists. Critical here because
  // DataForSEO calls cost real money.
  const dup = await assertNotDuplicate(SUCCESS_EVENT, payload.idempotencyKey, log);
  if (dup.duplicate) return { items: 0, duplicate: true };

  const client = new DataForSEOClient({ brandId: payload.brandId ?? null });
  // No try/catch around the side-effect block: failures bubble to the
  // BullMQ Worker, which records `integration.error` only on TERMINAL
  // failure (attemptsMade >= max) so retries don't pollute observability.
  const res = await client.serpGoogleOrganicLive({
    keyword: payload.query,
    locationCode: payload.locationCode,
    languageCode: payload.languageCode,
  });

  const items = res.tasks[0]?.result?.[0]?.items?.length ?? 0;
  log.info({ keyword: payload.query, items }, "dataforseo serp test: ok");

  await db.insert(eventsTable).values({
    eventType: SUCCESS_EVENT,
    brandId: payload.brandId ?? null,
    scope: payload.brandId ? "brand" : "global",
    subjectType: "integration",
    subjectId: "dataforseo",
    payload: {
      idempotencyKey: payload.idempotencyKey,
      keyword: payload.query,
      items,
      cost: res.cost,
    },
  });

  return { items };
}
