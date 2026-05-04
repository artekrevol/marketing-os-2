import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { TrendChartSvg, type ChartDataPoint, type InitiativeMarker } from "./chart-svg";

const BRAND_COLOR = "#1E293B";
const ACCENT = "#2563EB";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#334155",
  },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottom: 2,
    borderBottomColor: BRAND_COLOR,
    paddingBottom: 6,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: BRAND_COLOR,
  },
  headerSub: {
    fontSize: 8,
    color: "#64748B",
  },
  brandName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: BRAND_COLOR,
    marginBottom: 2,
  },
  dateRow: {
    fontSize: 8,
    color: "#64748B",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BRAND_COLOR,
    marginBottom: 6,
    marginTop: 12,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  metricBox: {
    flex: 1,
    padding: 8,
    backgroundColor: "#F8FAFC",
    borderRadius: 4,
    border: 1,
    borderColor: "#E2E8F0",
  },
  metricLabel: {
    fontSize: 7,
    color: "#64748B",
    marginBottom: 2,
    textTransform: "uppercase" as const,
  },
  metricValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: BRAND_COLOR,
  },
  metricDelta: {
    fontSize: 7,
    marginTop: 1,
  },
  chartContainer: {
    marginVertical: 8,
    alignItems: "center",
  },
  initiativeRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottom: 0.5,
    borderBottomColor: "#E2E8F0",
  },
  initiativeName: {
    flex: 3,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: BRAND_COLOR,
  },
  initiativeType: {
    flex: 2,
    fontSize: 8,
    color: "#64748B",
  },
  initiativeStatus: {
    flex: 1,
    fontSize: 8,
  },
  initiativeImpact: {
    flex: 1,
    fontSize: 8,
    color: "#64748B",
    textAlign: "right",
  },
  projectionBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: "#F0F9FF",
    borderRadius: 4,
    border: 1,
    borderColor: "#BAE6FD",
  },
  projectionLabel: {
    fontSize: 8,
    color: "#0369A1",
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  projectionValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: BRAND_COLOR,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: 0.5,
    borderTopColor: "#CBD5E1",
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: "#94A3B8",
  },
  emptyNote: {
    fontSize: 9,
    color: "#94A3B8",
    fontStyle: "italic",
    marginTop: 4,
  },
});

export interface BrandReportData {
  brandName: string;
  generatedDate: string;
  baselineDate: string | null;
  avgPosition: { current: number | null; baseline: number | null };
  top10: { current: number | null; baseline: number | null };
  top3: { current: number | null; baseline: number | null };
  gscClicks: string;
  chartData: ChartDataPoint[];
  initiativeMarkers: InitiativeMarker[];
  projectionStartIndex?: number;
  initiatives: Array<{
    name: string;
    type: string;
    status: string;
    expectedImpactPct: string | null;
  }>;
  projection: {
    status: string;
    projectedRecoveryDate?: string;
    slope?: number;
  };
}

function formatDelta(current: number | null, baseline: number | null): string {
  if (current == null || baseline == null) return "—";
  const d = current - baseline;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}`;
}

function deltaColor(current: number | null, baseline: number | null, invert = false): string {
  if (current == null || baseline == null) return "#64748B";
  const d = current - baseline;
  if (invert) return d > 0 ? "#DC2626" : d < 0 ? "#16A34A" : "#64748B";
  return d > 0 ? "#16A34A" : d < 0 ? "#DC2626" : "#64748B";
}

function formatType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(s: string): string {
  if (s === "active") return "#2563EB";
  if (s === "completed") return "#16A34A";
  return "#94A3B8";
}

function BrandPage({ data, pageIndex }: { data: BrandReportData; pageIndex: number }) {
  const top3Initiatives = data.initiatives.slice(0, 3);

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.headerTitle}>TekRevol — Recovery War Room</Text>
        </View>
        <Text style={styles.headerSub}>Executive Summary</Text>
      </View>

      <Text style={styles.brandName}>{data.brandName}</Text>
      <Text style={styles.dateRow}>
        Generated: {data.generatedDate}
        {"    "}|{"    "}
        Baseline: {data.baselineDate ?? "Not locked"}
      </Text>

      <Text style={styles.sectionTitle}>Key Metrics</Text>
      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Avg Position (30d)</Text>
          <Text style={styles.metricValue}>
            {data.avgPosition.current != null ? data.avgPosition.current.toFixed(1) : "—"}
          </Text>
          <Text
            style={[
              styles.metricDelta,
              {
                color: deltaColor(
                  data.avgPosition.current,
                  data.avgPosition.baseline,
                  true,
                ),
              },
            ]}
          >
            vs baseline: {formatDelta(data.avgPosition.current, data.avgPosition.baseline)}
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Top 10 Keywords</Text>
          <Text style={styles.metricValue}>
            {data.top10.current != null ? data.top10.current : "—"}
          </Text>
          <Text
            style={[
              styles.metricDelta,
              { color: deltaColor(data.top10.current, data.top10.baseline) },
            ]}
          >
            vs baseline: {formatDelta(data.top10.current, data.top10.baseline)}
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Top 3 Keywords</Text>
          <Text style={styles.metricValue}>
            {data.top3.current != null ? data.top3.current : "—"}
          </Text>
          <Text
            style={[
              styles.metricDelta,
              { color: deltaColor(data.top3.current, data.top3.baseline) },
            ]}
          >
            vs baseline: {formatDelta(data.top3.current, data.top3.baseline)}
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>GSC Clicks</Text>
          <Text style={[styles.metricValue, { fontSize: 9 }]}>{data.gscClicks}</Text>
          <Text style={[styles.metricDelta, { color: "#94A3B8" }]}>pending ingestion</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>90-Day Trend (Gap to Baseline %)</Text>
      <View style={styles.chartContainer}>
        <TrendChartSvg
          data={data.chartData}
          baselineValue={0}
          initiatives={data.initiativeMarkers}
          projectionStartIndex={data.projectionStartIndex}
          width={510}
          height={170}
        />
      </View>

      <Text style={styles.sectionTitle}>Top Active Initiatives</Text>
      {top3Initiatives.length === 0 ? (
        <Text style={styles.emptyNote}>No initiatives logged yet.</Text>
      ) : (
        <>
          <View style={[styles.initiativeRow, { borderBottomColor: "#94A3B8" }]}>
            <Text style={[styles.initiativeName, { fontFamily: "Helvetica", fontSize: 7, color: "#64748B" }]}>Name</Text>
            <Text style={[styles.initiativeType, { fontSize: 7 }]}>Type</Text>
            <Text style={[styles.initiativeStatus, { fontSize: 7, color: "#64748B" }]}>Status</Text>
            <Text style={[styles.initiativeImpact, { fontSize: 7 }]}>Impact %</Text>
          </View>
          {top3Initiatives.map((init, idx) => (
            <React.Fragment key={idx}>
              <View style={styles.initiativeRow}>
                <Text style={styles.initiativeName}>{init.name}</Text>
                <Text style={styles.initiativeType}>{formatType(init.type)}</Text>
                <Text style={[styles.initiativeStatus, { color: statusColor(init.status) }]}>
                  {init.status}
                </Text>
                <Text style={styles.initiativeImpact}>
                  {init.expectedImpactPct != null ? `${init.expectedImpactPct}%` : "—"}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </>
      )}

      <View style={styles.projectionBox}>
        <Text style={styles.projectionLabel}>Projected Recovery Date</Text>
        <Text style={styles.projectionValue}>
          {data.projection.status === "projecting" && data.projection.projectedRecoveryDate
            ? data.projection.projectedRecoveryDate
            : data.projection.status === "recovered"
              ? "Recovered"
              : data.projection.status === "gap_widening"
                ? "Gap widening — no convergence"
                : "Insufficient data"}
        </Text>
      </View>

      <View style={styles.footer} fixed>
        <Text style={styles.footerText}>TekRevol — Recovery War Room</Text>
        <Text
          style={styles.footerText}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </Page>
  );
}

export function RecoveryReport({ brands }: { brands: BrandReportData[] }) {
  return (
    <Document title="Recovery War Room — Executive Summary" author="SEO OS">
      {brands.map((brand, i) => (
        <React.Fragment key={brand.brandName}>
          <BrandPage data={brand} pageIndex={i} />
        </React.Fragment>
      ))}
    </Document>
  );
}
