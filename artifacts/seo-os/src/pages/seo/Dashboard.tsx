import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  KeyRound, MapPin, Users, CalendarClock, Upload, TrendingDown,
  AlertTriangle, Link2, Lightbulb, TrendingUp, TrendingDown as TrendDown,
  X, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { seo } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

/* -------------------------------------------------------------------------- */
/* Upload drawer                                                               */
/* -------------------------------------------------------------------------- */
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
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadM = useMutation({
    mutationFn: () => seo.ahrefsUpload(brandId, files),
    onSuccess: (data) => {
      toast.success(
        `Imported ${Object.values(data.imported).reduce((a, b) => a + b, 0).toLocaleString()} rows across ${data.imported ? Object.keys(data.imported).length : 0} file types`,
      );
      onSuccess();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".csv"),
    );
    setFiles((prev) => {
      const urls = new Set(prev.map((f) => f.name));
      return [...prev, ...valid.filter((f) => !urls.has(f.name))];
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background border border-rule rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-serif text-xl tracking-tight">Upload Ahrefs Snapshot</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Export from Ahrefs and drop all files here — we auto-detect each type.
            </p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink ml-4">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
            dragging ? "border-accent bg-accent/5" : "border-rule hover:border-accent/60"
          }`}
        >
          <Upload className="h-8 w-8 text-ink-muted mx-auto mb-2" />
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
          <ul className="mt-3 space-y-1">
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

        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 border border-rule rounded-sm px-4 py-2 text-sm text-ink-muted hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => uploadM.mutate()}
            disabled={files.length === 0 || uploadM.isPending}
            className="flex-1 bg-ink text-paper rounded-sm px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {uploadM.isPending ? "Importing…" : `Import ${files.length} file${files.length !== 1 ? "s" : ""}`}
          </button>
        </div>
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

  const invalidateAhrefs = () =>
    qc.invalidateQueries({ queryKey: ["seo", "ahrefs-summary", brandId] });

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
