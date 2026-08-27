import { useEffect, useState } from "react";
import { DollarSign, Zap, Database, AlertTriangle, RefreshCw } from "lucide-react";

type Summary = {
  since: string;
  scope?: string;
  brand_id?: string | null;
  totals: {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    cost_usd: number;
    cache_hit_rate: number;
    errors: number;
  };
  by_stage: Array<{
    stage: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number;
  }>;
  by_project: Array<{
    project_id: string;
    topic: string | null;
    calls: number;
    cost_usd: number;
    total_tokens: number;
  }>;
};

const RANGES: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

export default function AdminUsage() {
  const [range, setRange] = useState<keyof typeof RANGES>("7d");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - RANGES[range] * 24 * 60 * 60 * 1000).toISOString();
    const resp = await fetch(`/api/admin/usage?since=${encodeURIComponent(since)}`, {
      credentials: "include",
    });
    setData(resp.ok ? await resp.json() : null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const t = data?.totals;

  return (
    <div className="max-w-6xl mx-auto px-10 py-10">
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted">Admin</p>
          <h1 className="font-serif text-3xl mt-1">AI usage & cost</h1>
          <p className="text-[11px] uppercase tracking-widest text-accent mt-2">
            Scope: {data?.scope || "all-brands"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-xs px-3 py-1.5 border rounded-sm transition-colors ${
                range === r ? "bg-ink text-paper border-ink" : "border-rule hover:bg-secondary"
              }`}
            >
              {r}
            </button>
          ))}
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 border border-rule rounded-sm hover:bg-secondary inline-flex items-center gap-1.5"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      {t && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-10">
            <Stat icon={<DollarSign className="h-4 w-4" />} label="Total cost" value={`$${t.cost_usd.toFixed(2)}`} />
            <Stat icon={<Zap className="h-4 w-4" />} label="API calls" value={t.calls.toLocaleString()} sub={`${t.errors} errors`} />
            <Stat
              icon={<Database className="h-4 w-4" />}
              label="Cache hit rate"
              value={`${t.cache_hit_rate}%`}
              sub={`${(t.cache_read_tokens / 1000).toFixed(1)}k read / ${(t.cache_creation_tokens / 1000).toFixed(1)}k written`}
            />
            <Stat
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Tokens"
              value={`${((t.input_tokens + t.output_tokens) / 1000).toFixed(1)}k`}
              sub={`${(t.input_tokens / 1000).toFixed(1)}k in · ${(t.output_tokens / 1000).toFixed(1)}k out`}
            />
          </div>

          <h2 className="font-serif text-xl mb-3">Cost by stage</h2>
          <div className="notebook-card overflow-x-auto mb-10">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
                <tr>
                  <Th>Stage</Th>
                  <Th>Calls</Th>
                  <Th>Input</Th>
                  <Th>Output</Th>
                  <Th>Cache read</Th>
                  <Th>Cache write</Th>
                  <Th>Cost</Th>
                </tr>
              </thead>
              <tbody>
                {data!.by_stage.map((s) => (
                  <tr key={s.stage} className="border-t border-rule">
                    <Td className="font-mono text-xs">{s.stage}</Td>
                    <Td>{s.calls}</Td>
                    <Td>{s.input_tokens.toLocaleString()}</Td>
                    <Td>{s.output_tokens.toLocaleString()}</Td>
                    <Td className="text-verified">{s.cache_read_tokens.toLocaleString()}</Td>
                    <Td className="text-ink-muted">{s.cache_creation_tokens.toLocaleString()}</Td>
                    <Td>${Number(s.cost_usd).toFixed(4)}</Td>
                  </tr>
                ))}
                {data!.by_stage.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-muted text-sm">No usage in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="font-serif text-xl mb-3">Top projects by cost</h2>
          <div className="notebook-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-[10px] uppercase tracking-widest text-ink-muted">
                <tr>
                  <Th>Topic</Th>
                  <Th>Calls</Th>
                  <Th>Tokens</Th>
                  <Th>Cost</Th>
                </tr>
              </thead>
              <tbody>
                {data!.by_project.map((p) => (
                  <tr key={p.project_id} className="border-t border-rule">
                    <Td>
                      <div className="max-w-md truncate">{p.topic || <span className="text-ink-muted italic">deleted project</span>}</div>
                    </Td>
                    <Td>{p.calls}</Td>
                    <Td>{Number(p.total_tokens).toLocaleString()}</Td>
                    <Td>${Number(p.cost_usd).toFixed(4)}</Td>
                  </tr>
                ))}
                {data!.by_project.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-muted text-sm">No projects in this range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="notebook-card p-4">
      <div className="flex items-center gap-2 text-ink-muted text-[10px] uppercase tracking-widest mb-2">
        {icon} {label}
      </div>
      <div className="font-serif text-2xl">{value}</div>
      {sub && <div className="text-[11px] text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="text-left px-4 py-3 font-medium">{children}</th>
);
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <td className={`px-4 py-3 ${className}`}>{children}</td>
);