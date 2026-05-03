import { useState } from "react";
import { CheckCircle2, Pencil, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RecoveryInitiative } from "@/lib/api";
import { typeLabel } from "./initiative-form";

/**
 * Read-only detail panel for an initiative card. Exposes three
 * affordances depending on caller role + current status:
 *
 *  - Edit:     admin or editor, status === "active"
 *  - Complete: admin or editor, status === "active"
 *  - Abandon:  admin only,      status === "active"
 *
 * Action handlers are passed in by the parent (Recovery.tsx) so the
 * modal stays a pure renderer with no fetch logic of its own.
 */
export function InitiativeDetailModal({
  open,
  onOpenChange,
  initiative,
  canWrite,
  isAdmin,
  onEdit,
  onComplete,
  onAbandon,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initiative: RecoveryInitiative | null;
  canWrite: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onAbandon: () => void;
}) {
  const [confirmingAction, setConfirmingAction] = useState<null | "complete" | "abandon">(
    null,
  );

  const isActive = initiative?.status === "active";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setConfirmingAction(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {initiative?.name ?? "Initiative"}
          </DialogTitle>
          <DialogDescription>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={initiative?.status ?? "active"} />
              <span className="capitalize">{initiative?.status ?? "—"}</span>
              {initiative && (
                <span className="text-ink-muted">
                  · {typeLabel(initiative.type)}
                </span>
              )}
            </span>
          </DialogDescription>
        </DialogHeader>

        {initiative && (
          <div className="space-y-4 text-sm">
            {initiative.description && (
              <p className="text-ink whitespace-pre-wrap leading-relaxed">
                {initiative.description}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs">
              <dt className="text-ink-muted">Started</dt>
              <dd className="font-mono">
                {new Date(initiative.started_at).toLocaleString()}
              </dd>
              {initiative.completed_at && (
                <>
                  <dt className="text-ink-muted">Completed</dt>
                  <dd className="font-mono">
                    {new Date(initiative.completed_at).toLocaleString()}
                  </dd>
                </>
              )}
              {initiative.expected_impact_pct != null && (
                <>
                  <dt className="text-ink-muted">Expected impact</dt>
                  <dd className="font-mono">
                    +{initiative.expected_impact_pct}%
                  </dd>
                </>
              )}
              {initiative.expected_impact_clicks != null && (
                <>
                  <dt className="text-ink-muted">Expected clicks</dt>
                  <dd className="font-mono">
                    +{initiative.expected_impact_clicks.toLocaleString()}
                  </dd>
                </>
              )}
              {initiative.actual_impact_clicks_14d != null && (
                <>
                  <dt className="text-ink-muted">Actual clicks (14d)</dt>
                  <dd className="font-mono">
                    {initiative.actual_impact_clicks_14d.toLocaleString()}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        {confirmingAction && (
          <div className="border border-amber-300 bg-amber-50 rounded-sm p-3 text-xs">
            Click <span className="font-medium">
              {confirmingAction === "complete" ? "Continue → Complete" : "Continue → Abandon"}
            </span>{" "}
            below to open the {confirmingAction} dialog.
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {isActive && canWrite && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                onEdit();
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          )}
          {isActive && canWrite && (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onComplete();
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Mark complete
            </Button>
          )}
          {isActive && isAdmin && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onOpenChange(false);
                onAbandon();
              }}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Abandon
            </Button>
          )}
          {!isActive && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-emerald-500"
      : status === "completed"
        ? "bg-blue-500"
        : status === "abandoned"
          ? "bg-ink-muted"
          : "bg-ink-muted";
  return <span className={`h-2 w-2 rounded-full ${cls}`} />;
}
