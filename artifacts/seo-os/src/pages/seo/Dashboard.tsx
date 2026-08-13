import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  KeyRound, MapPin, Users, CalendarClock, Upload, TrendingDown,
  AlertTriangle, Link2, Lightbulb, TrendingUp, TrendingDown as TrendDown,
  X, CheckCircle2, Clock, Loader2, CheckCheck, FolderOpen, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

/* -------------------------------------------------------------------------- */
/* Upload drawer — two-step: store files in GCS, then ingest in background    */
/* -------------------------------------------------------------------------- */
function defaultSnapshotMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function UploadDrawer({
  brandId,
  onClose,
  onSuccess,
}: {
  brandId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [snapshotMonth, setSnapshotMonth] = useState(defaultSnapshotMonth);
  const [phase, setPhase] = useState<"pick" | "uploading" | "queued">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".csv"),
    );
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !existing.has(f.name))];
    });
  };

  const startUpload = async () => {
    if (files.length === 0) return;
    setPhase("uploading");
    setProgress({ done: 0, total: files.length });
    setUploadErr(null);
    try {
      // 1. Create the snapshot record
      const { snapshotId } = await seo.ahrefsCreateSnapshot(brandId, snapshotMonth);
      // 2. Upload each file individually (avoids any body-size limit)
      for (let i = 0; i < files.length; i++) {
        await seo.ahrefsUploadFile(brandId, snapshotId, files[i]!);
        setProgress({ done: i + 1, total: files.length });
      }
      // 3. Enqueue the background ingest job
      await seo.ahrefsIngestSnapshot(brandId, snapshotId);
      setPhase("queued");
      toast.success(
        `${files.length} file${files.length !== 1 ? "s" : ""} stored — import running in background`,
      );
      onSuccess();
      setTimeout(onClose, 1200);
    } catch (e) {
      setUploadErr(String(e));
      setPhase("pick");
    }
  };

  // Auto-close after "queued" state is shown briefly
  useEffect(() => {
    if (phase !== "queued") return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background border border-rule rounded-lg shadow-xl w-full max-w-lg p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-serif text-xl tracking-tight">Upload Ahrefs Snapshot</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Files are stored in GCS and imported in the background — no timeouts.
            </p>
          </div>
          <button onClick={onClose} disabled={phase === "uploading"} className="text-ink-muted hover:text-ink ml-4 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === "uploading" ? (
          /* ── Uploading progress ── */
          <div className="py-8 text-center">
            <Loader2 className="h-8 w-8 text-accent mx-auto mb-3 animate-spin" />
            <p className="text-sm font-medium">
              Uploading {progress.done} / {progress.total} files…
            </p>
            <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-ink-muted mt-2">
              Each file is securely stored. Do not close this tab.
            </p>
          </div>
        ) : phase === "queued" ? (
          /* ── Queued ── */
          <div className="py-8 text-center">
            <CheckCheck className="h-8 w-8 text-green-500 mx-auto mb-3" />
            <p className="text-sm font-medium">Import queued!</p>
            <p className="text-xs text-ink-muted mt-1">
              The background worker is processing your files. Check the snapshot history for progress.
            </p>
          </div>
        ) : (
          /* ── Pick files ── */
          <>
            {/* Month picker */}
            <div className="mb-3 flex items-center gap-3">
              <label className="text-xs font-medium text-ink-muted whitespace-nowrap">Snapshot month</label>
              <input
                type="month"
                value={snapshotMonth}
                onChange={(e) => setSnapshotMonth(e.target.value)}
                className="flex-1 border border-rule rounded-sm px-2 py-1 text-sm bg-background focus:outline-none focus:border-accent"
              />
              <span className="text-[11px] text-ink-muted">(YYYY-MM)</span>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors ${
                dragging ? "border-accent bg-accent/5" : "border-rule hover:border-accent/60"
              }`}
            >
              <Upload className="h-7 w-7 text-ink-muted mx-auto mb-2" />
              <p className="text-sm text-ink-muted">
                Drop Ahrefs XLSX files here or <span className="text-accent underline">browse</span>
              </p>
              <p className="text-xs text-ink-muted mt-1">
                Backlinks · ReferringDomains · Anchors · BrokenBacklinks · OrganicKeywords · TopPages · ContentGap
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <ul className="mt-3 max-h-36 overflow-y-auto space-y-1">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center justify-between text-xs">
                    <span className="truncate text-ink-muted">{f.name}</span>
                    <button
                      onClick={() => setFiles((p) => p.filter((x) => x.name !== f.name))}
                      className="text-ink-muted hover:text-red-500 ml-2 shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {uploadErr && (
              <p className="mt-2 text-xs text-red-500">{uploadErr}</p>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={onClose}
                className="flex-1 border border-rule rounded-sm px-4 py-2 text-sm text-ink-muted hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={startUpload}
                disabled={files.length === 0}
                className="flex-1 bg-ink text-paper rounded-sm px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Upload &amp; Queue Import ({files.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Snapshot history — date-month folders with status badges                   */
/* -------------------------------------------------------------------------- */
type RawSnapshot = {
  id: string;
  snapshot_month: string;
  status: string;
  file_count: number;
  row_counts: Record<string, number> | null;
  error_message: string | null;
  created_at: string;
  ingest_started_at: string | null;
  ingest_completed_at: string | null;
  backlink_count: number | null;
  page_count: number | null;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    );
  if (status === "ingesting")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
        <Loader2 className="h-3 w-3 animate-spin" /> Processing
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
        <AlertTriangle className="h-3 w-3" /> Error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted bg-secondary border border-rule rounded-full px-2 py-0.5">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function SnapshotHistory({
  brandId,
  onRetrigger,
}: {
  brandId: string;
  onRetrigger: () => void;
}) {
  const qc = useQueryClient();
  const snapshotsQ = useQuery({
    queryKey: ["seo", "ahrefs-snapshots", brandId],
    queryFn: () => seo.ahrefsListSnapshots(brandId),
    refetchInterval: (q) => {
      const snaps: RawSnapshot[] = (q.state.data as { snapshots: RawSnapshot[] } | undefined)?.snapshots ?? [];
      const hasActive = snaps.some((s) => s.status === "ingesting" || s.status === "pending");
      return hasActive ? 5_000 : false;
    },
    staleTime: 10_000,
  });

  const snapshots: RawSnapshot[] = snapshotsQ.data?.snapshots ?? [];

  if (snapshots.length === 0 && !snapshotsQ.isLoading) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-ink-muted" />
          Snapshot History
        </h3>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["seo", "ahrefs-snapshots", brandId] })}
          className="text-ink-muted hover:text-ink"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="border border-rule rounded-md divide-y divide-rule overflow-hidden">
        {snapshotsQ.isLoading ? (
          <div className="p-4 text-xs text-ink-muted text-center">Loading…</div>
        ) : snapshots.length === 0 ? (
          <div className="p-4 text-xs text-ink-muted text-center">No snapshots yet</div>
        ) : (
          snapshots.map((snap) => {
            const totalRows = snap.row_counts
              ? Object.values(snap.row_counts).reduce((a, b) => a + b, 0)
              : null;
            return (
              <div key={snap.id} className="flex items-center justify-between px-4 py-3 bg-background hover:bg-secondary/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <FolderOpen className="h-4 w-4 text-ink-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{snap.snapshot_month}</p>
                    <p className="text-[11px] text-ink-muted">
                      {snap.file_count} file{snap.file_count !== 1 ? "s" : ""}
                      {totalRows != null && ` · ${totalRows.toLocaleString()} rows ingested`}
                      {snap.ingest_completed_at &&
                        ` · ${new Date(snap.ingest_completed_at).toLocaleDateString()}`}
                    </p>
                    {snap.status === "error" && snap.error_message && (
                      <p className="text-[11px] text-red-500 mt-0.5 truncate max-w-xs" title={snap.error_message}>
                        {snap.error_message}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <StatusBadge status={snap.status} />
                  {snap.status === "error" && (
                    <button
                      onClick={async () => {
                        try {
                          await seo.ahrefsIngestSnapshot(brandId, snap.id);
                          toast.success("Re-queued for import");
                          qc.invalidateQueries({ queryKey: ["seo", "ahrefs-snapshots", brandId] });
                          onRetrigger();
                        } catch (e) {
                          toast.error(String(e));
                        }
                      }}
                      className="text-xs text-accent underline hover:no-underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alerts rail panels                                                          */
/* -------------------------------------------------------------------------- */
type AhrefsSummary = Awaited<ReturnType<typeof seo.ahrefsSummary>>;

function TrafficCrashPanel({ data }: { data: AhrefsSummary }) {
  const crashed = data?.crashedPages ?? [];
  return (
    <div className="border border-rule rounded-md bg-background p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="h-4 w-4 text-red-500 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Traffic Crashes</span>
        {crashed.length > 0 && (
          <span className="ml-auto bg-red-100 text-red-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
            {crashed.length} pages
          </span>
        )}
      </div>
      {crashed.length === 0 ? (
        <p className="text-xs text-ink-muted">No major traffic drops detected.</p>
      ) : (
        <ul className="space-y-2 flex-1">
          {crashed.slice(0, 4).map((p) => {
            const pct = (p.prev_traffic ?? 0) > 0
              ? Math.round(((p.traffic_change ?? 0) / (p.prev_traffic as number)) * 100)
              : 0;
            const urlPath = (() => { try { return new URL(p.url).pathname; } catch { return p.url; } })();
            return (
              <li key={p.url} className="text-xs">
                <span className="block truncate text-ink font-medium">{urlPath}</span>
                <span className="text-red-600 font-mono">{pct}%</span>
                <span className="text-ink-muted ml-1">
                  {(p.prev_traffic ?? 0).toLocaleString()} → {(p.curr_traffic ?? 0).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/seo/site-health"
        className="mt-3 text-xs text-accent hover:underline"
      >
        View site health →
      </Link>
    </div>
  );
}

function BrokenLinksPanel({ data }: { data: AhrefsSummary }) {
  const links = data?.brokenHighDrLinks ?? [];
  const uniqueDomains = [...new Set(links.map((l) => l.domain))].slice(0, 3);
  return (
    <div className="border border-rule rounded-md bg-background p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Broken Links</span>
        {links.length > 0 && (
          <span className="ml-auto bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
            {links.length} DR 40+
          </span>
        )}
      </div>
      {links.length === 0 ? (
        <p className="text-xs text-ink-muted">No high-DR broken links detected.</p>
      ) : (
        <div className="flex-1">
          <p className="text-xs text-ink-muted mb-2">
            {links.length} backlinks from DR 40+ domains point to broken targets.
          </p>
          <ul className="space-y-1">
            {uniqueDomains.map((d) => (
              <li key={d} className="text-xs font-medium text-ink">{d}</li>
            ))}
          </ul>
          {uniqueDomains.length < links.length && (
            <p className="text-[11px] text-ink-muted mt-1">
              +{links.length - uniqueDomains.length} more
            </p>
          )}
        </div>
      )}
      <Link
        href="/seo/site-health"
        className="mt-3 text-xs text-accent hover:underline"
      >
        View broken links → fix
      </Link>
    </div>
  );
}

function ContentGapPanel({ data }: { data: AhrefsSummary }) {
  const gaps = data?.topGapOpportunities ?? [];
  return (
    <div className="border border-rule rounded-md bg-background p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="h-4 w-4 text-green-500 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Content Gaps</span>
        {gaps.length > 0 && (
          <span className="ml-auto bg-green-100 text-green-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
            opportunities
          </span>
        )}
      </div>
      {gaps.length === 0 ? (
        <p className="text-xs text-ink-muted">No gap data yet — upload the ContentGap export.</p>
      ) : (
        <ul className="space-y-2 flex-1">
          {gaps.map((g) => (
            <li key={g.keyword} className="text-xs">
              <span className="block font-medium text-ink truncate">{g.keyword}</span>
              <span className="text-ink-muted">
                Vol {(g.volume ?? 0).toLocaleString()} · KD {g.kd} · #{g.competitor_position} {g.competitor_domain}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/seo/content-gap"
        className="mt-3 text-xs text-accent hover:underline"
      >
        View full list →
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Link velocity strip                                                         */
/* -------------------------------------------------------------------------- */
function LinkVelocity({ data }: { data: AhrefsSummary }) {
  const velocity = data?.linkVelocity;
  if (!velocity) return null;
  const newLinks = velocity.new_links ?? 0;
  const lostLinks = velocity.lost_links ?? 0;
  const net = newLinks - lostLinks;
  return (
    <div className="border border-rule rounded-md bg-background p-4 flex items-center gap-6 flex-wrap">
      <div className="text-xs text-ink-muted uppercase tracking-wide">Link velocity</div>
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-green-500" />
        <span className="text-sm font-medium text-ink">{newLinks.toLocaleString()}</span>
        <span className="text-xs text-ink-muted">active</span>
      </div>
      <div className="flex items-center gap-1.5">
        <TrendDown className="h-3.5 w-3.5 text-red-400" />
        <span className="text-sm font-medium text-ink">{lostLinks.toLocaleString()}</span>
        <span className="text-xs text-ink-muted">lost</span>
      </div>
      <div className="flex items-center gap-1.5">
        {net >= 0 ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        )}
        <span className={`text-sm font-medium ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
          {net >= 0 ? "+" : ""}{net.toLocaleString()} net
        </span>
      </div>
      {data?.latestBatch?.imported_at && (
        <span className="ml-auto text-[11px] text-ink-muted">
          Last import: {new Date(data.latestBatch.imported_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main dashboard component                                                    */
/* -------------------------------------------------------------------------- */
function DashboardInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const [uploaderOpen, setUploaderOpen] = useState(false);

  const statsQ = useQuery({
    queryKey: ["seo", "dashboard", brandId],
    queryFn: () => seo.dashboardStats(brandId),
    staleTime: 30_000,
  });
  const ahrefsQ = useQuery({
    queryKey: ["seo", "ahrefs-summary", brandId],
    queryFn: () => seo.ahrefsSummary(brandId),
    staleTime: 60_000,
  });

  const s = statsQ.data;
  const ahrefs = ahrefsQ.data;
  const hasAhrefsData = !!ahrefs?.latestBatch;

  const invalidateAhrefs = () => {
    qc.invalidateQueries({ queryKey: ["seo", "ahrefs-summary", brandId] });
    qc.invalidateQueries({ queryKey: ["seo", "ahrefs-snapshots", brandId] });
  };

  return (
    <>
      {uploaderOpen && (
        <UploadDrawer
          brandId={brandId}
          onClose={() => setUploaderOpen(false)}
          onSuccess={invalidateAhrefs}
        />
      )}
      <SeoShell
        title="SEO Dashboard"
        subtitle="Keyword tracking, rankings, and competitor intelligence"
        actions={
          <button
            onClick={() => setUploaderOpen(true)}
            className="flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
          >
            <Upload className="h-4 w-4" />
            Upload Ahrefs Snapshot
          </button>
        }
      >
        {/* Stat cards */}
        {statsQ.isLoading ? (
          <StateBox>Loading stats…</StateBox>
        ) : statsQ.isError ? (
          <StateBox>Failed to load stats: {(statsQ.error as Error).message}</StateBox>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              icon={<KeyRound className="h-4 w-4" />}
              label="Tracked keywords"
              value={s?.keyword_count ?? 0}
              href="/seo/keywords"
            />
            <StatCard
              icon={<MapPin className="h-4 w-4" />}
              label="Locations"
              value={s?.location_count ?? 0}
              href="/seo/locations"
            />
            <StatCard
              icon={<Users className="h-4 w-4" />}
              label="Competitor domains"
              value={s?.competitor_count ?? 0}
              href="/seo/competitors"
            />
            <StatCard
              icon={<CalendarClock className="h-4 w-4" />}
              label="Active schedules"
              value={s?.active_schedule_count ?? 0}
              href="/seo/schedules"
            />
            <StatCard
              icon={<Upload className="h-4 w-4" />}
              label="Ahrefs snapshots"
              value={hasAhrefsData ? 1 : 0}
              href="#"
              onClick={() => setUploaderOpen(true)}
              sublabel={
                ahrefs?.latestBatch
                  ? new Date(ahrefs.latestBatch.imported_at).toLocaleDateString()
                  : "Upload to start"
              }
            />
          </div>
        )}

        {/* Ahrefs section */}
        {ahrefsQ.isLoading ? null : !hasAhrefsData ? (
          <div className="mt-6 border border-dashed border-rule rounded-md bg-secondary/30 p-8 text-center">
            <Upload className="h-8 w-8 text-ink-muted mx-auto mb-2" />
            <p className="text-sm text-ink-muted font-medium">No Ahrefs data yet</p>
            <p className="text-xs text-ink-muted mt-1 mb-4">
              Upload your weekly Ahrefs exports to see site health alerts, backlink velocity, and content gap opportunities.
            </p>
            <button
              onClick={() => setUploaderOpen(true)}
              className="inline-flex items-center gap-2 bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent"
            >
              <Upload className="h-4 w-4" />
              Upload Ahrefs Snapshot
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* Link velocity */}
            {ahrefs && <LinkVelocity data={ahrefs} />}

            {/* Alerts rail */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {ahrefs && <TrafficCrashPanel data={ahrefs} />}
              {ahrefs && <BrokenLinksPanel data={ahrefs} />}
              {ahrefs && <ContentGapPanel data={ahrefs} />}
            </div>
          </div>
        )}

        {/* Snapshot history — shows all past uploads with live status */}
        <SnapshotHistory
          brandId={brandId}
          onRetrigger={invalidateAhrefs}
        />

        {/* Last crawl */}
        <div className="mt-4">
          <StateBox>
            Last completed crawl:{" "}
            <span className="font-medium text-ink">
              {s?.last_crawl_at ? new Date(s.last_crawl_at).toLocaleString() : "never"}
            </span>
            . Trigger a fresh crawl from the{" "}
            <Link href="/seo/rankings" className="text-accent underline">
              Rankings
            </Link>{" "}
            page.
          </StateBox>
        </div>
      </SeoShell>
    </>
  );
}

function StatCard({
  icon, label, value, href, sublabel, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
  sublabel?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2 text-ink-muted text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="font-serif text-3xl mt-2 tracking-tight">{value}</div>
      {sublabel && <div className="text-[11px] text-ink-muted mt-0.5">{sublabel}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="block w-full text-left border border-rule rounded-md bg-background p-5 hover:border-accent transition-colors"
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className="block border border-rule rounded-md bg-background p-5 hover:border-accent transition-colors"
    >
      {inner}
    </Link>
  );
}

export default withBrand("SEO Dashboard", undefined, (brandId) => (
  <DashboardInner brandId={brandId} />
));
