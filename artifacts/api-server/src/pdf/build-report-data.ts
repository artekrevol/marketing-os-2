import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  getRecoveryOverview,
  getSnapshots,
  getInitiatives,
} from "@workspace/services-recovery";
import type { BrandReportData } from "./recovery-report";
import type { ChartDataPoint, InitiativeMarker } from "./chart-svg";

interface BrandRow {
  id: string;
  name: string;
}

export async function listAllBrands(): Promise<BrandRow[]> {
  const result = (await db.execute(
    sql`select id, name from public.brands order by name`,
  )) as unknown as { rows?: BrandRow[] } | BrandRow[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

export async function buildBrandReportData(
  brandId: string,
  brandName: string,
): Promise<BrandReportData> {
  const [overview, snapshots, initiatives] = await Promise.all([
    getRecoveryOverview(brandId),
    getSnapshots(brandId, { days: 90 }),
    getInitiatives(brandId),
  ]);

  const baseline = overview.baseline;
  const current = overview.current;

  const chartData: ChartDataPoint[] = snapshots.map((s) => ({
    label: s.snapshotDate,
    value:
      s.gapToBaselineTop10Pct != null ? Number(s.gapToBaselineTop10Pct) : null,
  }));

  const initiativeMarkers: InitiativeMarker[] = [];
  const activeInits = initiatives.filter((i) => i.status === "active");
  for (const init of activeInits) {
    const startDate = new Date(init.startedAt).toISOString().slice(0, 10);
    const idx = snapshots.findIndex((s) => s.snapshotDate >= startDate);
    if (idx >= 0) {
      initiativeMarkers.push({ label: init.name, index: idx });
    }
  }

  let projectionStartIndex: number | undefined;
  if (
    overview.projection.status === "projecting" &&
    snapshots.length > 0
  ) {
    projectionStartIndex = Math.max(0, snapshots.length - 7);
  }

  const projectionDisplay: BrandReportData["projection"] = {
    status: overview.projection.status,
  };
  if (
    overview.projection.status === "projecting" &&
    "projectedRecoveryDate" in overview.projection
  ) {
    const d = overview.projection.projectedRecoveryDate;
    projectionDisplay.projectedRecoveryDate =
      d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
  }
  if ("slope" in overview.projection) {
    projectionDisplay.slope = overview.projection.slope;
  }

  const generatedDate = new Date().toISOString().slice(0, 10);

  return {
    brandName,
    generatedDate,
    baselineDate: baseline?.baselineDate ?? null,
    avgPosition: {
      current:
        current?.avgPosition30d != null
          ? Number(current.avgPosition30d)
          : null,
      baseline:
        baseline?.baselineAvgPosition != null
          ? Number(baseline.baselineAvgPosition)
          : null,
    },
    top10: {
      current: current?.keywordsInTop10 ?? null,
      baseline: baseline?.baselineKeywordsInTop10 ?? null,
    },
    top3: {
      current: current?.keywordsInTop3 ?? null,
      baseline: baseline?.baselineKeywordsInTop3 ?? null,
    },
    gscClicks: "— (pending GSC ingestion)",
    chartData,
    initiativeMarkers,
    projectionStartIndex,
    initiatives: initiatives.filter((i) => i.status === "active").slice(0, 10).map((i) => ({
      name: i.name,
      type: i.type,
      status: i.status,
      expectedImpactPct:
        i.expectedImpactPct != null ? String(i.expectedImpactPct) : null,
    })),
    projection: projectionDisplay,
  };
}
