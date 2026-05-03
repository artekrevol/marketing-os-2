import { eq } from "drizzle-orm";
import {
  withBrandScope,
  recoveryBaselinesTable,
  type RecoveryBaseline,
} from "@workspace/db";

/** Return the (single) locked baseline for a brand, or null. */
export async function getBaseline(
  brandId: string,
): Promise<RecoveryBaseline | null> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const rows = (await scoped.select(recoveryBaselinesTable, {
      where: eq(recoveryBaselinesTable.brandId, brandId),
      limit: 1,
    })) as RecoveryBaseline[];
    return rows[0] ?? null;
  });
}
