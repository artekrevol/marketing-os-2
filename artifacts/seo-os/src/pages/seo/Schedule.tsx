import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { seo, type SeoCrawlSchedule } from "@/lib/api";
import { SeoShell, withBrand, StateBox } from "./_shell";

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Daily at 02:00", value: "0 2 * * *" },
  { label: "Weekly (Mon 02:00)", value: "0 2 * * 1" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
];

function ScheduleInner({ brandId }: { brandId: string }) {
  const qc = useQueryClient();

  const listsQ = useQuery({
    queryKey: ["seo", "keyword-lists", brandId],
    queryFn: () => seo.listKeywordLists(brandId),
  });
  const schedulesQ = useQuery({
    queryKey: ["seo", "schedules", brandId],
    queryFn: () => seo.listSchedules(brandId),
  });

  const [cron, setCron] = useState(CRON_PRESETS[0]!.value);
  const [listId, setListId] = useState("");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["seo", "schedules", brandId] });

  const createM = useMutation({
    mutationFn: () =>
      seo.createSchedule({ brandId, cronExpression: cron.trim(), listId: listId || null }),
    onSuccess: () => {
      toast.success("Schedule created");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleM = useMutation({
    mutationFn: (s: SeoCrawlSchedule) =>
      seo.updateSchedule(s.id, { brandId, active: !s.active }),
    onSuccess: () => {
      toast.success("Schedule updated");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => seo.deleteSchedule(brandId, id),
    onSuccess: () => {
      toast.success("Schedule deleted");
      void invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lists = listsQ.data ?? [];
  const schedules = schedulesQ.data ?? [];
  const listName = (id: string | null) =>
    id ? (lists.find((l) => l.id === id)?.name ?? "—") : "All keywords";

  return (
    <SeoShell title="Schedules" subtitle="Recurring rank-check crawls (cron-based)">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (cron.trim()) createM.mutate();
        }}
        className="border border-rule rounded-md bg-background p-4 mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
      >
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Cadence
          </span>
          <select
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="input"
          >
            {CRON_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Cron expression
          </span>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="input font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-ink-muted mb-1">
            Keyword list
          </span>
          <select value={listId} onChange={(e) => setListId(e.target.value)} className="input">
            <option value="">All keywords</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!cron.trim() || createM.isPending}
          className="bg-ink text-paper px-4 py-2 rounded-sm text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {createM.isPending ? "Creating…" : "Add schedule"}
        </button>
      </form>

      {schedulesQ.isLoading ? (
        <StateBox>Loading schedules…</StateBox>
      ) : schedules.length === 0 ? (
        <StateBox>No schedules yet. Recurring crawls keep rankings fresh automatically.</StateBox>
      ) : (
        <div className="border border-rule rounded-md bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-ink-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Cron</th>
                <th className="text-left font-medium px-4 py-2">Scope</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium px-4 py-2">Last run</th>
                <th className="px-4 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-t border-rule">
                  <td className="px-4 py-2 font-mono text-xs">{s.cronExpression}</td>
                  <td className="px-4 py-2">{listName(s.listId)}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleM.mutate(s)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        s.active
                          ? "bg-green-100 text-green-800"
                          : "bg-secondary text-ink-muted"
                      }`}
                    >
                      {s.active ? "active" : "paused"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted">
                    {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteM.mutate(s.id)}
                      className="text-ink-muted hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SeoShell>
  );
}

export default withBrand("Schedules", undefined, (brandId) => (
  <ScheduleInner brandId={brandId} />
));
