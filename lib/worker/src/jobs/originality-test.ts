import { guardedDb as db, eventsTable } from "@workspace/db";
import type { JobData } from "@workspace/jobs";
import { OriginalityAIClient } from "@workspace/integrations-originality-ai";
import type { Logger } from "pino";
import { assertNotDuplicate } from "./idempotency";

const SUCCESS_EVENT = "integration.originality.test.ok";

export async function handleOriginalityScanTest(
  payload: JobData<"integrations.originality-ai-scan-test">,
  log: Logger,
): Promise<{
  aiScore: number | null;
  plagiarismScore: number | null;
  scanId: string | null;
  duplicate?: true;
}> {
  const dup = await assertNotDuplicate(SUCCESS_EVENT, payload.idempotencyKey, log);
  if (dup.duplicate) {
    return { aiScore: null, plagiarismScore: null, scanId: null, duplicate: true };
  }

  const client = new OriginalityAIClient({ brandId: payload.brandId ?? null });
  // Failures bubble to the worker. The Worker's `failed` listener emits
  // `integration.error` only on terminal failure.
  const res = await client.scanText(payload.text);
  log.info(
    { aiScore: res.aiScore, plagiarismScore: res.plagiarismScore },
    "originality scan test: ok",
  );

  await db.insert(eventsTable).values({
    eventType: SUCCESS_EVENT,
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
}
