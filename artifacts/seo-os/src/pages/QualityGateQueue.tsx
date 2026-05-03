import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, RefreshCw, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveBrand } from "@/lib/brands";
import { supabase } from "@/lib/supabase";
import { qualityGate, type QueueItem } from "@/lib/api";

/**
 * Queue page — lists submitted/in_review content_objects for the active
 * brand, with realtime updates. Subscribes to:
 *   - content_objects (status changes on the row)
 *   - qa_runs         (run lifecycle: started → finished)
 * Both are filtered server-side by brand_id so cross-brand churn does
 * not trigger refetches.
 */
export default function QualityGateQueue() {
  const { activeBrand, loading: brandLoading } = useActiveBrand();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (brandLoading || !activeBrand) {
      setItems([]);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);

    const refresh = async () => {
      try {
        const { items } = await qualityGate.listQueue(activeBrand.id);
        if (mounted) setItems(items);
      } catch (err) {
        if (mounted) setError((err as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    refresh();

    const ch = supabase
      .channel(`qg-queue-${activeBrand.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "content_objects",
          filter: `brand_id=eq.${activeBrand.id}`,
        },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "qa_runs",
          filter: `brand_id=eq.${activeBrand.id}`,
        },
        () => refresh(),
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [activeBrand, brandLoading]);

  if (brandLoading) {
    return (
      <div className="p-8 text-sm text-ink-muted flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading brand…
      </div>
    );
  }

  if (!activeBrand) {
    return (
      <div className="p-8 text-sm text-ink-muted">
        No brand selected. Pick a brand in the sidebar to view its review queue.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <header className="flex items-end justify-between mb-6 pb-4 border-b border-rule">
        <div>
          <h1 className="font-serif text-2xl">Review queue</h1>
          <p className="text-sm text-ink-muted mt-1">
            Brand: <span className="font-medium">{activeBrand.name}</span> · {items.length}{" "}
            item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={() => activeBrand && qualityGate.listQueue(activeBrand.id).then((d) => setItems(d.items)).catch((e) => toast.error((e as Error).message))}
          className="text-xs text-ink-muted hover:text-accent flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      {loading && items.length === 0 && (
        <div className="text-sm text-ink-muted flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
        </div>
      )}

      {error && (
        <div className="border border-destructive/40 bg-destructive/5 text-destructive text-sm rounded-sm p-3 mb-4">
          {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="border border-dashed border-rule rounded-md p-12 text-center text-ink-muted text-sm">
          Nothing waiting for review. Drafts submitted from ContentForge appear here in real time.
        </div>
      )}

      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.id}
            className="border border-rule rounded-md bg-background hover:border-accent/50 transition-colors"
          >
            <Link
              href={`/quality-gate/${it.id}`}
              className="block px-4 py-3 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={it.status} />
                  {it.qa_run && <RunBadge status={it.qa_run.status} />}
                </div>
                <div className="font-medium text-sm truncate">{it.title || "(untitled)"}</div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {it.word_count != null ? `${it.word_count.toLocaleString()} words` : "—"} ·
                  updated {new Date(it.updated_at).toLocaleString()}
                </div>
              </div>
              <span className="text-xs text-ink-muted">Open →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    submitted: { label: "Submitted", cls: "bg-secondary text-ink" },
    in_review: { label: "In review", cls: "bg-accent text-accent-foreground" },
    approved: { label: "Approved", cls: "bg-verified/15 text-verified" },
    rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive" },
    drafting: { label: "Drafting", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

function RunBadge({ status }: { status: string }) {
  if (status === "completed")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-verified">
        <CheckCircle2 className="h-3 w-3" /> checks done
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-destructive">
        <AlertCircle className="h-3 w-3" /> checks failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-unverified">
      <Clock className="h-3 w-3 animate-pulse" /> {status}
    </span>
  );
}
