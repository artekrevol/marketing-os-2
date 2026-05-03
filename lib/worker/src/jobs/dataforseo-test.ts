import { db, eventsTable } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { DataForSEOClient, DataForSEOError } from "@workspace/integrations-dataforseo";
import type { Logger } from "pino";

export async function handleDataForSeoSerpTest(
  payload: JobData<"integrations.dataforseo-serp-test">,
  log: Logger,
): Promise<{ items: number }> {
  const client = new DataForSEOClient({
    brandId: payload.brandId ?? null,
  });

  try {
    const res = await client.serpGoogleOrganicLive({
      keyword: payload.query,
      locationCode: payload.locationCode,
      languageCode: payload.languageCode,
    });

    const items = res.tasks[0]?.result?.[0]?.items?.length ?? 0;
    log.info({ keyword: payload.query, items }, "dataforseo serp test: ok");

    await db.insert(eventsTable).values({
      eventType: "integration.dataforseo.test.ok",
      brandId: payload.brandId ?? null,
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
  } catch (err) {
    const isDfs = err instanceof DataForSEOError;
    log.error(
      { err, retriable: isDfs ? err.retriable : false, status: isDfs ? err.httpStatus : undefined },
      "dataforseo serp test: failed",
    );
    await db.insert(eventsTable).values({
      eventType: "integration.error",
      brandId: payload.brandId ?? null,
      subjectType: "integration",
      subjectId: "dataforseo",
      payload: {
        idempotencyKey: payload.idempotencyKey,
        endpoint: "/serp/google/organic/live/regular",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
