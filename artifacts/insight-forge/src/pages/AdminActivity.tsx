import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  user_id: string;
  user_email: string | null;
  path: string;
  visits: number;
  total_seconds: number;
  avg_seconds: number;
  max_seconds: number;
  last_seen: string;
};

type RecentEvent = {
  id: string;
  user_email: string | null;
  path: string;
  duration_ms: number | null;
  entered_at: string;
  project_id: string | null;
};

type ActivityResponse = {
  scope?: string;
  brand_id?: string | null;
  aggregate?: Row[];
  recent?: RecentEvent[];
};

const RANGES = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 24 * 7 },
  { label: "Last 30d", hours: 24 * 30 },
];

function fmtDuration(s: number) {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleString();
}

export default function AdminActivity() {
  const [rangeHours, setRangeHours] = useState(24);
  const [rows, setRows] = useState<Row[]>([]);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [scope, setScope] = useState("all-brands-and-system");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - rangeHours * 3600_000).toISOString();
    const resp = await fetch(`/api/admin/activity?since=${encodeURIComponent(since)}`, {
      credentials: "include",
    });
    if (resp.ok) {
      const body = (await resp.json()) as ActivityResponse;
      setScope(body.scope || "all-brands-and-system");
      setRows(body.aggregate || []);
      setRecent(body.recent || []);
    } else {
      toast.error("Failed to load activity");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeHours]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => (r.user_email || "").toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const byUser = useMemo(() => {
    const map = new Map<string, { email: string; total: number; visits: number; lastSeen: string }>();
    for (const r of filtered) {
      const key = r.user_email || r.user_id;
      const cur = map.get(key) || { email: r.user_email || r.user_id, total: 0, visits: 0, lastSeen: r.last_seen };
      cur.total += Number(r.total_seconds || 0);
      cur.visits += Number(r.visits || 0);
      if (new Date(r.last_seen) > new Date(cur.lastSeen)) cur.lastSeen = r.last_seen;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  return (
    <div className="max-w-6xl mx-auto px-10 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-1">Admin</p>
          <h1 className="font-serif text-3xl flex items-center gap-2">
            <Activity className="h-6 w-6 text-accent" /> Activity log
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            Time spent per user per page. Use this to find pages where users get stuck.
          </p>
          <p className="text-[11px] uppercase tracking-widest text-accent mt-2">
            Scope: {scope}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-rule rounded-sm overflow-hidden text-xs">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setRangeHours(r.hours)}
                className={`px-3 py-1.5 ${rangeHours === r.hours ? "bg-ink text-paper" : "hover:bg-secondary"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="border border-rule rounded-sm px-3 py-1.5 text-xs hover:bg-secondary inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by email or path…"
        className="w-full mb-6 px-3 py-2 bg-background border border-rule rounded-sm text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {loading ? (
        <div className="text-center py-20 text-ink-muted text-sm">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading activity…
        </div>
      ) : (
        <div className="space-y-10">
          {/* Per-user totals */}
          <section>
            <h2 className="font-serif text-xl mb-3">By user</h2>
            <div className="border border-rule rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
                  <tr>
                    <th className="text-left px-4 py-2">User</th>
                    <th className="text-right px-4 py-2">Visits</th>
                    <th className="text-right px-4 py-2">Total time</th>
                    <th className="text-right px-4 py-2">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-ink-muted italic">
                        No activity in this range.
                      </td>
                    </tr>
                  )}
                  {byUser.map((u) => (
                    <tr key={u.email} className="border-t border-rule">
                      <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-2 text-right">{u.visits}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmtDuration(u.total)}</td>
                      <td className="px-4 py-2 text-right text-ink-muted text-xs">{fmtRelative(u.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-user-per-page breakdown */}
          <section>
            <h2 className="font-serif text-xl mb-3">By user · page</h2>
            <div className="border border-rule rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
                  <tr>
                    <th className="text-left px-4 py-2">User</th>
                    <th className="text-left px-4 py-2">Path</th>
                    <th className="text-right px-4 py-2">Visits</th>
                    <th className="text-right px-4 py-2">Total</th>
                    <th className="text-right px-4 py-2">Avg</th>
                    <th className="text-right px-4 py-2">Max</th>
                    <th className="text-right px-4 py-2">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i} className="border-t border-rule">
                      <td className="px-4 py-2 font-mono text-xs">{r.user_email || r.user_id.slice(0, 8)}</td>
                      <td className="px-4 py-2 font-mono text-xs truncate max-w-[260px]">{r.path}</td>
                      <td className="px-4 py-2 text-right">{r.visits}</td>
                      <td className="px-4 py-2 text-right">{fmtDuration(Number(r.total_seconds))}</td>
                      <td className="px-4 py-2 text-right text-ink-muted">{fmtDuration(Math.round(Number(r.avg_seconds)))}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          Number(r.max_seconds) > 300 ? "text-destructive font-medium" : ""
                        }`}
                      >
                        {fmtDuration(Number(r.max_seconds))}
                      </td>
                      <td className="px-4 py-2 text-right text-ink-muted text-xs">{fmtRelative(r.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-muted mt-2 italic">
              Sessions over 5 minutes on a single page are highlighted — those usually indicate a stuck loading state.
            </p>
          </section>

          {/* Recent live events */}
          <section>
            <h2 className="font-serif text-xl mb-3">Recent events (last 100)</h2>
            <div className="border border-rule rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
                  <tr>
                    <th className="text-left px-4 py-2">When</th>
                    <th className="text-left px-4 py-2">User</th>
                    <th className="text-left px-4 py-2">Path</th>
                    <th className="text-right px-4 py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id} className="border-t border-rule">
                      <td className="px-4 py-2 text-xs text-ink-muted">{fmtRelative(e.entered_at)}</td>
                      <td className="px-4 py-2 font-mono text-xs">{e.user_email || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs truncate max-w-[320px]">{e.path}</td>
                      <td className="px-4 py-2 text-right">
                        {e.duration_ms != null ? fmtDuration(Math.round(e.duration_ms / 1000)) : <span className="text-ink-muted italic">live</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}