import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Lock,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useActiveBrand } from "@/lib/brands";
import {
  recovery,
  type RecoveryInitiative,
  type RecoveryOverview,
  type RecoverySnapshot,
} from "@/lib/api";

/**
 * Recovery War Room — read-only overview at /recovery (Sprint 4 §D.5).
 * Headline metric: rankings-based `gap_to_baseline_top10_pct`.
 * Clicks-based view stays as a placeholder until GSC ingestion lands.
 */
export default function Recovery() {
  const { loading: brandLoading, activeBrand, accessible } = useActiveBrand();

  if (brandLoading) {
    return <Shell title="Recovery War Room" subtitle="Loading…" />;
  }

  if (!activeBrand) {
    return (
      <Shell title="Recovery War Room" subtitle="No brand selected">
        <div className="border border-rule rounded-md bg-background p-6 text-sm text-ink-muted">
          {accessible.length === 0
            ? "You don't have access to any brands yet. Ask an admin to grant brand access."
            : "Select a brand from the sidebar to view its recovery dashboard."}
        </div>
      </Shell>
    );
  }

  return <RecoveryForBrand brandId={activeBrand.id} />;
}

function RecoveryForBrand({ brandId }: { brandId: string }) {
  // Snapshots are recomputed nightly so a 1h client cache is fine and
  // matches the spec; overview/initiatives stay shorter so an admin
  // who locks a baseline or starts an initiative sees it quickly.
  const overviewQ = useQuery({
    queryKey: ["recovery", "overview", brandId],
    queryFn: () => recovery.overview(brandId),
    staleTime: 60_000,
  });
  const snapshotsQ = useQuery({
    queryKey: ["recovery", "snapshots", brandId, 90],
    queryFn: () => recovery.snapshots(brandId, 90),
    staleTime: 60 * 60 * 1000,
  });
  const initiativesQ = useQuery({
    queryKey: ["recovery", "initiatives", brandId],
    queryFn: () => recovery.initiatives(brandId),
    staleTime: 60_000,
  });

  const overview = overviewQ.data;
  const snapshots = snapshotsQ.data ?? [];
  const initiatives = initiativesQ.data ?? [];

  if (overviewQ.isLoading) {
    return <Shell title="Recovery War Room" showBrandSelector>{loadingBlock()}</Shell>;
  }

  if (overviewQ.isError) {
    return (
      <Shell title="Recovery War Room" showBrandSelector>
        <ErrorBlock
          title="Failed to load overview"
          message={(overviewQ.error as Error).message}
        />
      </Shell>
    );
  }

  if (!overview) return null;

  // Empty state #1: baseline not locked. The dashboard relies on the
  // baseline for the headline metric; without it nothing else makes
  // sense to render.
  if (!overview.baseline) {
    return (
      <Shell title="Recovery War Room" showBrandSelector>
        <BaselineLockEmptyState />
      </Shell>
    );
  }

  // Empty state #2: baseline locked but no snapshots yet.
  if (!overview.current) {
    return (
      <Shell title="Recovery War Room" showBrandSelector>
        <SnapshotsEmptyState />
      </Shell>
    );
  }

  return (
    <Shell title="Recovery War Room" showBrandSelector>
      <div className="grid gap-6 lg:grid-cols-3">
        <HeadlineCard overview={overview} />
        <ProjectionCard overview={overview} />
        <BaselineCard overview={overview} />
      </div>

      <section className="mt-6">
        <h2 className="font-serif text-lg mb-3">90-day burn-down</h2>
        <div className="border border-rule rounded-md bg-background p-4">
          <TrendChart
            snapshots={snapshots}
            initiatives={initiatives}
            projection={overview.projection}
          />
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-lg">Initiatives</h2>
          <span className="text-xs text-ink-muted">
            {overview.activeInitiatives} active
          </span>
        </div>
        <InitiativesRibbon initiatives={initiatives} />
      </section>
    </Shell>
  );
}

// ---- Shell + small helpers ----

function Shell({
  title,
  subtitle,
  showBrandSelector = false,
  children,
}: {
  title: string;
  subtitle?: string;
  showBrandSelector?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-rule px-8 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl tracking-tight">{title}</h1>
            {subtitle && (
              <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {showBrandSelector && <HeaderBrandSelector />}
        </div>
      </header>
      <div className="px-8 py-6">{children}</div>
    </div>
  );
}

/**
 * Brand selector embedded in the Recovery page sticky header.
 * Mirrors the AppShell sidebar switcher and uses the same
 * useActiveBrand context so changes stay in sync across the app.
 */
function HeaderBrandSelector() {
  const { loading, accessible, activeBrand, setActiveBrand } = useActiveBrand();
  const [open, setOpen] = useState(false);

  if (loading || accessible.length === 0) return null;

  if (accessible.length === 1) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted px-3 py-1.5 border border-rule rounded-sm">
        <Building2 className="h-3.5 w-3.5" />
        <span className="font-medium text-ink">{accessible[0]!.name}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 border border-rule rounded-sm text-sm hover:bg-secondary transition-colors min-w-[12rem]"
      >
        <Building2 className="h-3.5 w-3.5 text-ink-muted shrink-0" />
        <span className="flex-1 text-left truncate font-medium">
          {activeBrand?.name ?? "Select brand"}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-background border border-rule rounded-sm shadow-md z-50 max-h-64 overflow-y-auto">
          {accessible.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setActiveBrand(b);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary ${
                activeBrand?.id === b.id ? "bg-secondary/60 font-medium" : ""
              }`}
            >
              {b.name}
              <span className="ml-2 text-[10px] font-mono text-ink-muted">
                {b.slug}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function loadingBlock() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {[0, 1, 2].map((k) => (
        <div
          key={k}
          className="border border-rule rounded-md bg-background h-40 animate-pulse"
        />
      ))}
    </div>
  );
}

function ErrorBlock({ title, message }: { title: string; message: string }) {
  return (
    <div className="border border-destructive/40 bg-destructive/5 rounded-md p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" /> {title}
      </div>
      <pre className="mt-2 text-xs whitespace-pre-wrap text-ink-muted">{message}</pre>
    </div>
  );
}

function BaselineLockEmptyState() {
  // Spec D.5: exact heading + admin lock CTA. The CTA is shown to
  // admins only — non-admins get a clear pointer to who owns the
  // action instead of a button that will 403.
  const { isAdmin } = useActiveBrand();
  return (
    <div className="border border-rule rounded-md bg-background p-8 max-w-2xl">
      <div className="flex items-start gap-3">
        <Lock className="h-5 w-5 text-accent shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-serif text-lg">Baseline not yet locked for this brand</h2>
          <p className="text-sm text-ink-muted mt-1">
            The Recovery War Room compares each day’s rankings against a locked
            pre-October-2025 baseline. An admin needs to lock that baseline
            before the dashboard can render.
          </p>
          {isAdmin ? (
            <Link
              href="/admin/recovery-baseline"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 border border-ink bg-ink text-paper text-sm rounded-sm hover:bg-ink/90 transition-colors"
            >
              <Lock className="h-3.5 w-3.5" />
              Lock baseline
            </Link>
          ) : (
            <p className="text-sm text-ink-muted mt-3">
              Ask a workspace admin to lock the baseline for this brand from
              the admin console.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SnapshotsEmptyState() {
  return (
    <div className="border border-rule rounded-md bg-background p-8 max-w-2xl">
      <div className="flex items-start gap-3">
        <Clock className="h-5 w-5 text-accent shrink-0 mt-0.5" />
        <div>
          <h2 className="font-serif text-lg">Snapshots not yet computed. Check back tomorrow.</h2>
          <p className="text-sm text-ink-muted mt-2">
            The nightly snapshot worker rolls up recovery metrics each night —
            your first datapoint will appear after the next run.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Cards ----

function positionTone(
  positionDelta: number | null,
): "green" | "yellow" | "red" | "neutral" {
  // Amendments §D.5: green if avg_position_30d at/above baseline
  // (delta ≤ 0 — lower position numbers are better), yellow if 0–3
  // worse, red if >3 worse.
  if (positionDelta == null) return "neutral";
  if (positionDelta <= 0) return "green";
  if (positionDelta <= 3) return "yellow";
  return "red";
}

function toneClasses(tone: ReturnType<typeof positionTone>): {
  border: string;
  bg: string;
  fg: string;
  dot: string;
} {
  switch (tone) {
    case "green":
      return {
        border: "border-emerald-300",
        bg: "bg-emerald-50",
        fg: "text-emerald-700",
        dot: "bg-emerald-500",
      };
    case "yellow":
      return {
        border: "border-amber-300",
        bg: "bg-amber-50",
        fg: "text-amber-700",
        dot: "bg-amber-500",
      };
    case "red":
      return {
        border: "border-red-300",
        bg: "bg-red-50",
        fg: "text-red-700",
        dot: "bg-red-500",
      };
    default:
      return {
        border: "border-rule",
        bg: "bg-background",
        fg: "text-ink-muted",
        dot: "bg-ink-muted",
      };
  }
}

function fmtNum(v: string | null | undefined, digits = 1): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function HeadlineCard({ overview }: { overview: RecoveryOverview }) {
  const baseline = overview.baseline!;
  const current = overview.current!;
  const curPosNum = current.avg_position_30d != null ? Number(current.avg_position_30d) : null;
  const basePosNum =
    baseline.baseline_avg_position != null ? Number(baseline.baseline_avg_position) : null;
  // Position delta: positive = we slipped, negative/zero = at or above baseline.
  // Lower numerical position is better, so delta = current - baseline.
  const positionDelta =
    curPosNum != null && basePosNum != null && Number.isFinite(curPosNum) && Number.isFinite(basePosNum)
      ? curPosNum - basePosNum
      : null;
  const tone = positionTone(positionDelta);
  const t = toneClasses(tone);

  // Required headline format: "11.1 (was 8.4, gap +2.7)".
  const headline = (() => {
    if (curPosNum == null || basePosNum == null || positionDelta == null) {
      return curPosNum != null ? curPosNum.toFixed(1) : "—";
    }
    const sign = positionDelta >= 0 ? "+" : "";
    return `${curPosNum.toFixed(1)} (was ${basePosNum.toFixed(1)}, gap ${sign}${positionDelta.toFixed(1)})`;
  })();

  // Sub-metrics: keyword count deltas vs baseline for top-10 and top-3.
  const top10Cur = current.keywords_in_top_10;
  const top10Base = baseline.baseline_keywords_in_top_10;
  const top10Delta = top10Cur - top10Base;
  const top3Cur = current.keywords_in_top_3;
  const top3Base = baseline.baseline_keywords_in_top_3;
  const top3Delta = top3Cur - top3Base;
  const fmtDelta = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  const deltaTone = (n: number) =>
    n >= 0 ? "text-emerald-700" : "text-red-700";

  return (
    <div className={`border ${t.border} ${t.bg} rounded-md p-5`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
        <span className={`h-2 w-2 rounded-full ${t.dot}`} />
        Avg position (30d) vs baseline
      </div>
      <div className={`mt-3 font-serif text-2xl ${t.fg}`}>{headline}</div>
      <div className="mt-3 grid grid-cols-2 gap-y-1 gap-x-3 text-xs">
        <div className="text-ink-muted">Keywords in Top-10</div>
        <div className="font-mono">
          {top10Cur} / {top10Base}{" "}
          <span className={deltaTone(top10Delta)}>({fmtDelta(top10Delta)})</span>
        </div>
        <div className="text-ink-muted">Keywords in Top-3</div>
        <div className="font-mono">
          {top3Cur} / {top3Base}{" "}
          <span className={deltaTone(top3Delta)}>({fmtDelta(top3Delta)})</span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-rule/60 text-[11px] text-ink-muted font-mono">
        — (pending GSC ingestion)
      </div>
    </div>
  );
}

function ProjectionCard({ overview }: { overview: RecoveryOverview }) {
  const p = overview.projection;
  const ico = (() => {
    switch (p.status) {
      case "recovered":
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
      case "projecting":
        return <TrendingUp className="h-4 w-4 text-accent" />;
      case "gap_widening":
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      default:
        return <Activity className="h-4 w-4 text-ink-muted" />;
    }
  })();

  let body: React.ReactNode;
  if (p.status === "recovered") {
    body = (
      <>
        <div className="font-serif text-2xl text-emerald-700">Recovered</div>
        <div className="mt-1 text-xs text-ink-muted">
          Latest gap {p.latestGapPct.toFixed(1)}% — at or above baseline.
        </div>
      </>
    );
  } else if (p.status === "projecting") {
    const date = new Date(p.projectedRecoveryDate);
    const days = Math.max(
      0,
      Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    body = (
      <>
        <div className="font-serif text-2xl">{date.toLocaleDateString()}</div>
        <div className="mt-1 text-xs text-ink-muted">
          ~{days} days at current slope ({p.pointsUsed} pts).
        </div>
      </>
    );
  } else if (p.status === "gap_widening") {
    body = (
      <>
        <div className="font-serif text-2xl text-red-700">Gap widening</div>
        <div className="mt-1 text-xs text-ink-muted">
          Slope is flat or negative. Add a recovery initiative.
        </div>
      </>
    );
  } else {
    const reason =
      p.reason === "insufficient_points"
        ? `Need more snapshots (${p.pointsUsed}/2 minimum)`
        : p.reason === "all_null"
          ? "No usable gap values yet"
          : "Snapshots lack date variance";
    body = (
      <>
        <div className="font-serif text-2xl text-ink-muted">No projection</div>
        <div className="mt-1 text-xs text-ink-muted">{reason}.</div>
      </>
    );
  }

  return (
    <div className="border border-rule rounded-md bg-background p-5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
        {ico}
        Projected recovery
      </div>
      <div className="mt-3">{body}</div>
    </div>
  );
}

function BaselineCard({ overview }: { overview: RecoveryOverview }) {
  const b = overview.baseline!;
  return (
    <div className="border border-rule rounded-md bg-background p-5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-muted">
        <Lock className="h-3.5 w-3.5" />
        Locked baseline
      </div>
      <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-3 text-sm">
        <div className="text-ink-muted">Date</div>
        <div className="font-mono">{b.baseline_date}</div>
        <div className="text-ink-muted">Avg position</div>
        <div className="font-mono">{fmtNum(b.baseline_avg_position, 1)}</div>
        <div className="text-ink-muted">Top-10</div>
        <div className="font-mono">{b.baseline_keywords_in_top_10}</div>
        <div className="text-ink-muted">Top-3</div>
        <div className="font-mono">{b.baseline_keywords_in_top_3}</div>
        <div className="text-ink-muted">Threshold</div>
        <div className="font-mono">{fmtNum(b.recovery_threshold_pct, 0)}%</div>
      </div>
    </div>
  );
}

// ---- Trend chart ----

type ChartPoint = {
  date: string;
  ts: number;
  // Sign-split series so Recharts can render the trend in red below
  // zero (we're behind baseline) and green at/above zero (we're at or
  // beyond it). Each row populates exactly one of gapNeg / gapPos; the
  // other is null. We also seed both at zero-crossings so adjacent
  // segments visually meet the x-axis.
  gapNeg: number | null;
  gapPos: number | null;
  projected?: number | null;
};

function TrendChart({
  snapshots,
  initiatives,
  projection,
}: {
  snapshots: RecoverySnapshot[];
  initiatives: RecoveryInitiative[];
  projection: RecoveryOverview["projection"];
}) {
  const data: ChartPoint[] = useMemo(() => {
    const base: ChartPoint[] = snapshots.map((s) => {
      const ts = new Date(s.snapshot_date).getTime();
      const g =
        s.gap_to_baseline_top10_pct != null
          ? Number(s.gap_to_baseline_top10_pct)
          : null;
      // Split into negative and non-negative series so each can be
      // rendered with its own color. At exactly zero we populate both
      // so the green and red segments share that point.
      const gapNeg = g != null && g < 0 ? g : null;
      const gapPos = g != null && g >= 0 ? g : null;
      return { date: s.snapshot_date, ts, gapNeg, gapPos };
    });

    if (projection.status === "projecting" && base.length > 0) {
      const target = new Date(projection.projectedRecoveryDate).getTime();
      const last = base[base.length - 1]!;
      const lastGap =
        last.gapNeg ?? last.gapPos ?? projection.latestGapPct;
      base.push({
        date: new Date(target).toISOString().slice(0, 10),
        ts: target,
        gapNeg: null,
        gapPos: null,
        projected: 0,
      });
      last.projected = lastGap;
    }
    return base;
  }, [snapshots, projection]);

  const initiativeMarkers = useMemo(() => {
    const xMin = data[0]?.ts ?? 0;
    const xMax = data[data.length - 1]?.ts ?? 0;
    return initiatives
      .map((i) => ({ x: new Date(i.started_at).getTime(), name: i.name, status: i.status }))
      .filter((m) => m.x >= xMin && m.x <= xMax);
  }, [initiatives, data]);

  if (snapshots.length === 0) {
    return (
      <div className="text-sm text-ink-muted py-12 text-center">
        No snapshots in the last 90 days yet.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-rule/60" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            width={48}
          />
          <Tooltip
            labelFormatter={(v) => new Date(Number(v)).toLocaleDateString()}
            formatter={(value: unknown, name) => {
              if (value == null) return ["—", name as string];
              const n = Number(value);
              return [`${n.toFixed(1)}%`, name as string];
            }}
            contentStyle={{ fontSize: 12 }}
          />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="2 2" />
          {initiativeMarkers.map((m, idx) => (
            <ReferenceLine
              key={idx}
              x={m.x}
              stroke="var(--accent, #c0392b)"
              strokeDasharray="3 3"
              label={{
                value: m.name.length > 18 ? m.name.slice(0, 17) + "…" : m.name,
                position: "top",
                fill: "currentColor",
                fontSize: 10,
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="gapNeg"
            name="Gap (below baseline)"
            stroke="#c0392b"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="gapPos"
            name="Gap (at or above baseline)"
            stroke="#16a34a"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="projected"
            name="Projection"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Initiatives ribbon ----

function InitiativesRibbon({ initiatives }: { initiatives: RecoveryInitiative[] }) {
  // Spec: read-only horizontal ribbon of ACTIVE initiatives only.
  // Completed/paused initiatives still show as markers on the trend
  // chart but are not surfaced here.
  const active = initiatives
    .filter((i) => i.status === "active")
    .sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    );

  if (active.length === 0) {
    return (
      <div className="border border-rule rounded-md bg-background p-6 text-sm text-ink-muted">
        No active initiatives. Track recovery work as initiatives so you can
        see what changed when the slope shifts.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex gap-3 pb-1">
        {active.map((i) => (
          <InitiativeCard key={i.id} initiative={i} />
        ))}
      </div>
    </div>
  );
}

function InitiativeCard({ initiative }: { initiative: RecoveryInitiative }) {
  const statusColor =
    initiative.status === "active"
      ? "bg-emerald-500"
      : initiative.status === "completed"
        ? "bg-blue-500"
        : initiative.status === "paused"
          ? "bg-amber-500"
          : "bg-ink-muted";
  return (
    <div className="border border-rule rounded-md bg-background p-4 w-72 shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{initiative.name}</div>
          <div className="text-[11px] uppercase tracking-widest text-ink-muted mt-0.5">
            {initiative.type}
          </div>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-ink-muted shrink-0">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          {initiative.status}
        </span>
      </div>
      {initiative.description && (
        <p className="mt-2 text-xs text-ink-muted line-clamp-2">
          {initiative.description}
        </p>
      )}
      <div className="mt-3 text-[11px] text-ink-muted">
        Started {new Date(initiative.started_at).toLocaleDateString()}
        {initiative.completed_at &&
          ` · Done ${new Date(initiative.completed_at).toLocaleDateString()}`}
      </div>
    </div>
  );
}
