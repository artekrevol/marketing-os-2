import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Info,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useActiveBrand } from "@/lib/brands";
import { supabase } from "@/lib/supabase";
import { qualityGate, type ReviewDetail, type CheckResult } from "@/lib/api";

/**
 * Review surface for a single content_object.
 *
 * Realtime channels (filtered by brand_id):
 *   - content_objects → react to status flips (e.g. another reviewer
 *     decided the same row in another tab)
 *   - qa_runs         → react to run lifecycle (started → completed)
 *   - qa_check_results→ stream individual check results as they land
 *
 * Decide button is enabled iff:
 *   - qa_run.status === 'completed'
 *   - no hard_fail check with passed=false (override path TODO Sprint 4)
 *   - content_object.status ∈ {submitted, in_review}
 */
export default function QualityGateReview({ id }: { id: string }) {
  const { activeBrand, loading: brandLoading } = useActiveBrand();
  const [, setLoc] = useLocation();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [deciding, setDeciding] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    if (brandLoading || !activeBrand) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    const refresh = async () => {
      try {
        const d = await qualityGate.getReview(activeBrand.id, id);
        if (mounted) setDetail(d);
      } catch (err) {
        if (mounted) setError((err as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    refresh();

    const ch = supabase
      .channel(`qg-review-${activeBrand.id}-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "content_objects",
          filter: `id=eq.${id}`,
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
        (payload) => {
          const row = payload.new as { content_object_id?: string } | null;
          if (row?.content_object_id === id) refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "qa_check_results",
          filter: `brand_id=eq.${activeBrand.id}`,
        },
        (payload) => {
          const row = payload.new as { qa_run_id?: string } | null;
          if (row?.qa_run_id && row.qa_run_id === detail?.qaRun?.id) refresh();
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
    // detail.qaRun.id is captured by the closure; re-subscribing on every
    // detail change would tear/rebuild the channel unnecessarily, so we
    // intentionally exclude it from the dependency list and accept that
    // newly-created runs only flow in once the next refresh() completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBrand, brandLoading, id]);

  const decide = async (decision: "approved" | "rejected") => {
    if (!activeBrand) return;
    if (decision === "rejected" && comment.trim().length === 0) {
      toast.error("Rejection requires a comment");
      return;
    }
    setDeciding(decision);
    try {
      await qualityGate.decide(activeBrand.id, id, decision, comment.trim() || undefined);
      toast.success(`${decision === "approved" ? "Approved" : "Rejected"}.`);
      setComment("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeciding(null);
    }
  };

  if (brandLoading || loading) {
    return (
      <div className="p-8 text-sm text-ink-muted flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading review…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <Link
          href="/quality-gate"
          className="text-xs text-ink-muted hover:text-accent flex items-center gap-1 mb-4"
        >
          <ArrowLeft className="h-3 w-3" /> Back to queue
        </Link>
        <div className="border border-destructive/40 bg-destructive/5 text-destructive text-sm rounded-sm p-3">
          {error ?? "Not found"}
        </div>
      </div>
    );
  }

  const co = detail.contentObject;
  const run = detail.qaRun;
  const hardFails = detail.checks.filter((c) => c.severity === "hard_fail" && c.passed === false);
  // Reject (request revision) is allowed any time the qa_run has
  // reached a terminal state and the object is still in the reviewer
  // queue. The API maps the DB status `passed` → `completed`, but
  // `failed` and `error` come through unchanged — so a hard-fail run
  // (status === "failed") is a *finished* run for the purposes of the
  // reviewer UI, just one where Approve is locked.
  // Approve carries the additional hard-fail gate — the service layer
  // enforces this too (HardFailBlockedError → 409); the UI disables
  // the button so reviewers don't get a confusing round-trip error.
  const runTerminal =
    !!run && (run.status === "completed" || run.status === "failed" || run.status === "error");
  const inReviewerQueue = co.status === "submitted" || co.status === "in_review";
  const rejectDisabled = !runTerminal || !inReviewerQueue;
  const approveDisabled =
    rejectDisabled || hardFails.length > 0 || run?.status !== "completed";

  return (
    <div className="max-w-5xl mx-auto p-8">
      <Link
        href="/quality-gate"
        className="text-xs text-ink-muted hover:text-accent flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to queue
      </Link>

      <header className="mb-6 pb-4 border-b border-rule">
        <h1 className="font-serif text-2xl">{co.title || "(untitled)"}</h1>
        <p className="text-xs text-ink-muted mt-1 font-mono">
          {co.id} · {co.word_count ?? 0} words · status {co.status}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-4 mb-8">
        <RunStatusCard run={run} />
        <ChecksSummaryCard checks={detail.checks} />
        <SignoffSummaryCard
          decidedAt={co.decided_at}
          status={co.status}
          signoffs={detail.signoffs}
        />
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted mb-2">
          Automated checks
        </h2>
        {detail.checks.length === 0 ? (
          <p className="text-sm text-ink-muted italic">
            No check results yet. Subscribed for live updates…
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.checks.map((c) => (
              <li key={c.id}>
                <CheckRow check={c} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted mb-2">
          Body preview
        </h2>
        <div className="border border-rule rounded-md bg-background p-4 max-h-96 overflow-y-auto">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-ink">
            {co.body_md ?? "(empty)"}
          </pre>
        </div>
      </section>

      {(co.status === "submitted" || co.status === "in_review") && (
        <section className="border border-rule rounded-md bg-background p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted mb-3">
            Reviewer decision
          </h2>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comment (required for rejection)"
            rows={3}
            className="w-full px-3 py-2 border border-rule rounded-sm text-sm bg-background mb-3"
          />
          {rejectDisabled && (
            <p className="text-xs text-unverified mb-3 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {!runTerminal
                ? "Waiting for automated checks to finish."
                : "Not in a decidable state."}
            </p>
          )}
          {!rejectDisabled && hardFails.length > 0 && (
            <p className="text-xs text-unverified mb-3 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Blocked by {hardFails.length} hard-fail check{hardFails.length === 1 ? "" : "s"} —
              approve is locked, but you can still send this back for revision.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => decide("approved")}
              disabled={approveDisabled || deciding !== null}
              className="bg-verified text-paper px-4 py-2 rounded-sm text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
              title={
                hardFails.length > 0
                  ? "Approve is blocked while a hard-fail check is unresolved."
                  : undefined
              }
            >
              {deciding === "approved" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              Approve
            </button>
            <button
              onClick={() => decide("rejected")}
              disabled={rejectDisabled || deciding !== null}
              className="bg-destructive text-destructive-foreground px-4 py-2 rounded-sm text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
            >
              {deciding === "rejected" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {hardFails.length > 0 ? "Request revision" : "Reject"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function RunStatusCard({ run }: { run: ReviewDetail["qaRun"] }) {
  if (!run) {
    return (
      <div className="border border-rule rounded-md p-3 bg-background">
        <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">QA run</div>
        <div className="text-sm">Not started</div>
      </div>
    );
  }
  const Icon =
    run.status === "completed" ? CheckCircle2 : run.status === "failed" ? XCircle : Clock;
  const cls =
    run.status === "completed"
      ? "text-verified"
      : run.status === "failed"
        ? "text-destructive"
        : "text-unverified";
  return (
    <div className="border border-rule rounded-md p-3 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">QA run</div>
      <div className={`text-sm flex items-center gap-1 ${cls}`}>
        <Icon className={`h-3.5 w-3.5 ${run.status !== "completed" && run.status !== "failed" ? "animate-pulse" : ""}`} />
        {run.status}
      </div>
      {run.started_at && (
        <div className="text-[10px] text-ink-muted mt-1">
          started {new Date(run.started_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

function ChecksSummaryCard({ checks }: { checks: CheckResult[] }) {
  const hardFails = checks.filter((c) => c.severity === "hard_fail" && c.passed === false).length;
  const warns = checks.filter((c) => c.severity === "warn" && c.passed === false).length;
  return (
    <div className="border border-rule rounded-md p-3 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Checks</div>
      <div className="text-sm">
        {checks.length} total
        {hardFails > 0 && (
          <span className="ml-2 text-destructive font-medium">{hardFails} blocked</span>
        )}
        {warns > 0 && <span className="ml-2 text-unverified">{warns} warn</span>}
      </div>
    </div>
  );
}

function SignoffSummaryCard({
  decidedAt,
  status,
  signoffs,
}: {
  decidedAt: string | null;
  status: string;
  signoffs: ReviewDetail["signoffs"];
}) {
  const last = signoffs[signoffs.length - 1];
  return (
    <div className="border border-rule rounded-md p-3 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-ink-muted mb-1">Sign-off</div>
      <div className="text-sm">
        {decidedAt ? `${status} · ${new Date(decidedAt).toLocaleString()}` : "Pending"}
      </div>
      {last?.comment && (
        <div className="text-[10px] text-ink-muted mt-1 truncate" title={last.comment}>
          {last.comment}
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: CheckResult }) {
  const failed = check.passed === false;
  const Icon =
    check.severity === "hard_fail" && failed
      ? XCircle
      : failed
        ? AlertTriangle
        : check.passed === true
          ? CheckCircle2
          : Info;
  const cls = failed
    ? check.severity === "hard_fail"
      ? "text-destructive border-destructive/40 bg-destructive/5"
      : "text-unverified border-unverified/40 bg-unverified/5"
    : check.passed === true
      ? "text-verified border-verified/30 bg-verified/5"
      : "text-ink-muted border-rule bg-background";
  return (
    <div className={`border rounded-sm px-3 py-2 ${cls}`}>
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono text-xs">{check.check_key}</span>
        <span className="text-[10px] uppercase tracking-widest opacity-70">{check.severity}</span>
        {check.threshold != null && (
          <span className="ml-auto text-[10px] font-mono opacity-70">
            obs {check.observed ?? "—"} / thr {check.threshold}
          </span>
        )}
      </div>
      {check.details && Object.keys(check.details).length > 0 && (
        <pre className="text-[10px] font-mono opacity-70 mt-1 whitespace-pre-wrap">
          {JSON.stringify(check.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
