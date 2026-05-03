import { and, desc, eq, inArray } from "drizzle-orm";
import {
  withBrandScope,
  recoveryInitiativesTable,
  type RecoveryInitiative,
  type RecoveryInitiativeStatus,
} from "@workspace/db";

export interface GetInitiativesOptions {
  /** Filter by one or more status values. Default: all statuses. */
  statuses?: ReadonlyArray<RecoveryInitiativeStatus>;
  /** Cap results. Default: no cap. */
  limit?: number;
}

/**
 * List initiatives for a brand, newest-started first. The DB index
 * `recovery_initiatives_brand_status_started_idx` covers this query
 * shape.
 */
export async function getInitiatives(
  brandId: string,
  opts: GetInitiativesOptions = {},
): Promise<RecoveryInitiative[]> {
  return withBrandScope(brandId, async ({ scoped }) => {
    const baseFilter = eq(recoveryInitiativesTable.brandId, brandId);
    const where =
      opts.statuses && opts.statuses.length > 0
        ? and(
            baseFilter,
            inArray(
              recoveryInitiativesTable.status,
              opts.statuses as unknown as string[],
            ),
          )!
        : baseFilter;

    return (await scoped.select(recoveryInitiativesTable, {
      where,
      orderBy: desc(recoveryInitiativesTable.startedAt),
      limit: opts.limit,
    })) as RecoveryInitiative[];
  });
}
