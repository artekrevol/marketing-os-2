import { useEffect, useState, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Server, AlertTriangle, RefreshCw, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

type QueueCount = {
  name: string;
  wait: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
};

type EventRow = {
  id: string;
  brandId: string | null;
  actorId: string | null;
  eventType: string;
  subjectType: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type DeadJobRow = {
  id: string;
  queueName: string;
  jobName: string;
  jobId: string;
  payload: Record<string, unknown>;
  failureReason: string;
  attemptsMade: number;
  failedAt: string;
};

type Freshness = {
  lastEventAt: string | null;
  ageSeconds: number | null;
  payload?: Record<string, unknown>;
};

const POLL_MS = 5_000;

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try { body = await res.json(); } catch { /* ignore */ }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export default function AdminSystem() {
  const [authState, setAuthState] = useState<"loading" | "ok" | "denied">("loading");
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [queues, setQueues] = useState<QueueCount[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [deadJobs, setDeadJobs] = useState<DeadJobRow[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auth-lock pattern (preserved from AppShell). Never await Supabase
  // inside onAuthStateChange — defer with setTimeout.
  useEffect(() => {
    let cancelled = false;
    const handle = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (cancelled) return;
      if (!session) {
        setAuthState("denied");
        return;
      }
      const userId = session.user.id;
      setTimeout(async () => {
        if (cancelled) return;
        try {
          const [{ data: roles }, { data: profile }] = await Promise.all([
            supabase.from("user_roles").select("role").eq("user_id", userId),
            supabase.from("user_profiles").select("role").eq("user_id", userId).maybeSingle(),
          ]);
          if (cancelled) return;
          const admin =
            !!(roles || []).find((r) => r.role === "admin") || profile?.role === "admin";
          setAuthState(admin ? "ok" : "denied");
        } catch {
          if (!cancelled) setAuthState("denied");
        }
      }, 0);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => handle(s));
    supabase.auth.getSession().then(({ data }) => handle(data.session));
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const refresh = useCallback(async () => {
    if (authState !== "ok") return;
    setErrorMsg(null);
    try {
      const [f, q, e, d] = await Promise.all([
        api<Freshness>("/admin/system/heartbeat-freshness"),
        api<{ queues: QueueCount[] }>("/admin/system/queues"),
        api<{ events: EventRow[] }>(`/admin/system/events${eventTypeFilter ? `?type=${encodeURIComponent(eventTypeFilter)}` : ""}`),
        api<{ deadJobs: DeadJobRow[] }>("/admin/system/dead-jobs"),
      ]);
      setFreshness(f);
      setQueues(q.queues);
      setEvents(e.events);
      setDeadJobs(d.deadJobs);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  }, [authState, eventTypeFilter]);

  useEffect(() => {
    if (authState !== "ok") return;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [authState, refresh]);

  const trigger = async (path: string, label: string) => {
    setBusy(label);
    try {
      await api(`/admin/system/${path}`, { method: "POST" });
      toast.success(`${label} enqueued`);
      await refresh();
    } catch (err) {
      toast.error(`${label} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-muted text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }
  if (authState === "denied") {
    // Direct navigation by a non-admin: bounce back to the home dashboard.
    return <Navigate to="/" replace />;
  }

  const ageStr = freshness?.ageSeconds == null
    ? "no data"
    : freshness.ageSeconds < 60 ? `${freshness.ageSeconds}s ago`
    : freshness.ageSeconds < 3600 ? `${Math.floor(freshness.ageSeconds/60)}m ago`
    : `${Math.floor(freshness.ageSeconds/3600)}h ago`;
  const ageStale = (freshness?.ageSeconds ?? Infinity) > 120;

  return (
    <div className="min-h-screen p-8 bg-paper text-ink">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl tracking-tight flex items-center gap-2">
            <Server className="h-5 w-5 text-accent" /> System
          </h1>
          <p className="text-xs text-ink-muted mt-1">Worker, queues, integrations · auto-refresh 5s</p>
        </div>
        <button
          onClick={refresh}
          className="text-sm flex items-center gap-1.5 px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {errorMsg && (
        <div className="mb-4 px-4 py-2 border border-red-300 bg-red-50 text-red-800 text-sm rounded-sm">
          {errorMsg}
        </div>
      )}

      {/* Trigger row */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          disabled={!!busy}
          onClick={() => trigger("heartbeat", "Heartbeat")}
          className="flex items-center gap-1.5 px-3 py-2 bg-ink text-paper rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {busy === "Heartbeat" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Trigger heartbeat
        </button>
        <button
          disabled={!!busy}
          onClick={() => trigger("test-dataforseo", "DataForSEO test")}
          className="flex items-center gap-1.5 px-3 py-2 border border-rule rounded-sm text-sm hover:bg-secondary disabled:opacity-50"
        >
          {busy === "DataForSEO test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Test DataForSEO
        </button>
        <button
          disabled={!!busy}
          onClick={() => trigger("test-originality", "Originality test")}
          className="flex items-center gap-1.5 px-3 py-2 border border-rule rounded-sm text-sm hover:bg-secondary disabled:opacity-50"
        >
          {busy === "Originality test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Test Originality.ai
        </button>
      </div>

      <section className="grid md:grid-cols-3 gap-4 mb-8">
        {/* Heartbeat freshness */}
        <div className="border border-rule rounded-sm p-4 bg-background">
          <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Worker heartbeat</div>
          <div className={`text-2xl font-serif ${ageStale ? "text-red-700" : ""}`}>{ageStr}</div>
          <div className="text-xs text-ink-muted mt-2 truncate">
            {freshness?.lastEventAt ? new Date(freshness.lastEventAt).toLocaleString() : "—"}
          </div>
        </div>

        {/* Queue depths */}
        <div className="border border-rule rounded-sm p-4 bg-background md:col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-2">Queues</div>
          <div className="text-xs">
            <table className="w-full">
              <thead className="text-ink-muted">
                <tr>
                  <th className="text-left font-normal py-1">queue</th>
                  <th className="text-right font-normal">wait</th>
                  <th className="text-right font-normal">active</th>
                  <th className="text-right font-normal">delayed</th>
                  <th className="text-right font-normal">failed</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.name} className="border-t border-rule/50">
                    <td className="py-1 font-mono">{q.name}</td>
                    <td className="text-right tabular-nums">{q.wait}</td>
                    <td className="text-right tabular-nums">{q.active}</td>
                    <td className="text-right tabular-nums">{q.delayed}</td>
                    <td className={`text-right tabular-nums ${q.failed > 0 ? "text-red-700" : ""}`}>{q.failed}</td>
                  </tr>
                ))}
                {queues.length === 0 && (
                  <tr><td colSpan={5} className="text-ink-muted italic py-2">No queue data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Recent events */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-serif text-lg flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" /> Recent events
          </h2>
          <input
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            placeholder="filter by event_type…"
            className="text-xs px-2 py-1 border border-rule rounded-sm bg-background w-64"
          />
        </div>
        <div className="border border-rule rounded-sm bg-background">
          <table className="w-full text-xs">
            <thead className="text-ink-muted">
              <tr className="border-b border-rule">
                <th className="text-left font-normal py-2 px-3">when</th>
                <th className="text-left font-normal">event_type</th>
                <th className="text-left font-normal">subject</th>
                <th className="text-left font-normal">payload</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td colSpan={4} className="italic text-ink-muted py-3 px-3">No events.</td></tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b border-rule/40">
                  <td className="py-1.5 px-3 font-mono text-ink-muted whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="font-mono">{e.eventType}</td>
                  <td className="font-mono text-ink-muted">{e.subjectType ?? "—"}{e.subjectId ? `:${e.subjectId}` : ""}</td>
                  <td className="font-mono text-ink-muted truncate max-w-md">{JSON.stringify(e.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Dead jobs */}
      <section>
        <h2 className="font-serif text-lg flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-red-600" /> Dead-letter jobs
          {deadJobs.length > 0 && <span className="text-xs text-ink-muted">({deadJobs.length})</span>}
        </h2>
        <div className="border border-rule rounded-sm bg-background">
          <table className="w-full text-xs">
            <thead className="text-ink-muted">
              <tr className="border-b border-rule">
                <th className="text-left font-normal py-2 px-3">when</th>
                <th className="text-left font-normal">queue</th>
                <th className="text-left font-normal">job</th>
                <th className="text-left font-normal">attempts</th>
                <th className="text-left font-normal">reason</th>
              </tr>
            </thead>
            <tbody>
              {deadJobs.length === 0 && (
                <tr><td colSpan={5} className="italic text-ink-muted py-3 px-3">No dead jobs.</td></tr>
              )}
              {deadJobs.map((d) => (
                <tr key={d.id} className="border-b border-rule/40">
                  <td className="py-1.5 px-3 font-mono text-ink-muted whitespace-nowrap">
                    {new Date(d.failedAt).toLocaleString()}
                  </td>
                  <td className="font-mono">{d.queueName}</td>
                  <td className="font-mono">{d.jobName}</td>
                  <td className="font-mono">{d.attemptsMade}</td>
                  <td className="font-mono truncate max-w-md text-red-700">{d.failureReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
