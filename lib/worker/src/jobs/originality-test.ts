import { db, eventsTable } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { OriginalityAIClient, OriginalityAIError } from "@workspace/integrations-originality-ai";
import type { Logger } from "pino";

export async function handleOriginalityScanTest(
  payload: JobData<"integrations.originality-ai-scan-test">,
  log: Logger,
): Promise<{ aiScore: number | null; plagiarismScore: number | null; scanId: string | null }> {
  const client = new OriginalityAIClient({
    brandId: payload.brandId ?? null,
  });

  try {
    const res = await client.scanText(payload.text);
    log.info({ aiScore: res.aiScore, plagiarismScore: res.plagiarismScore }, "originality scan test: ok");

    await db.insert(eventsTable).values({
      eventType: "integration.originality.test.ok",
      brandId: payload.brandId ?? null,
      subjectType: "integration",
      subjectId: "originality-ai",
      payload: {
        idempotencyKey: payload.idempotencyKey,
        aiScore: res.aiScore,
        plagiarismScore: res.plagiarismScore,
        scanId: res.scanId,
      },
    });

    return { aiScore: res.aiScore, plagiarismScore: res.plagiarismScore, scanId: res.scanId };
  } catch (err) {
    const isOrig = err instanceof OriginalityAIError;
    log.error(
      { err, retriable: isOrig ? err.retriable : false, status: isOrig ? err.httpStatus : undefined },
      "originality scan test: failed",
    );
    await db.insert(eventsTable).values({
      eventType: "integration.error",
      brandId: payload.brandId ?? null,
      subjectType: "integration",
      subjectId: "originality-ai",
      payload: {
        idempotencyKey: payload.idempotencyKey,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
