import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recovery, type RecoveryInitiative } from "@/lib/api";

/**
 * Admin-only abandon confirmation. The reason is mandatory — it is
 * the audit-trail entry surfaced on the `recovery.initiative_abandoned`
 * event payload, since the initiatives row carries no
 * `abandonment_reason` column.
 */
export function AbandonModal({
  open,
  onOpenChange,
  brandId,
  initiative,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  brandId: string;
  initiative: RecoveryInitiative | null;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open, initiative?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!initiative) throw new Error("Missing initiative");
      const trimmed = reason.trim();
      if (trimmed.length === 0) {
        throw new Error("Reason is required.");
      }
      if (trimmed.length > 2000) {
        throw new Error("Reason must be ≤ 2000 characters.");
      }
      return recovery.abandonInitiative(initiative.id, {
        brandId,
        reason: trimmed,
      });
    },
    onSuccess: async () => {
      toast.success("Initiative abandoned");
      await qc.invalidateQueries({ queryKey: ["recovery"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif text-red-700">
            Abandon initiative
          </DialogTitle>
          <DialogDescription>
            {initiative ? (
              <>
                You're about to abandon{" "}
                <span className="font-medium text-ink">{initiative.name}</span>.
                It will be removed from the active ribbon but the marker stays
                on the burn-down chart so the audit trail remains intact.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="abandon-reason">
              Reason <span className="text-red-700">*</span>
            </Label>
            <Textarea
              id="abandon-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are we abandoning this initiative?"
              rows={4}
              required
              maxLength={2000}
            />
            <p className="text-[11px] text-ink-muted">
              {reason.trim().length}/2000 — required
            </p>
          </div>
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm px-2 py-1.5">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={mutation.isPending || !initiative || reason.trim().length === 0}
            >
              {mutation.isPending ? "Abandoning…" : "Abandon initiative"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
