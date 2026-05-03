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
 * Confirms completion of an active initiative. Notes are optional but
 * encouraged — they ride along on the `recovery.initiative_completed`
 * event payload (see `complete-initiative.ts`) and become the audit
 * trail for the eventual 14-day actual-impact comparison.
 */
export function CompletionModal({
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
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNotes("");
      setError(null);
    }
  }, [open, initiative?.id]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!initiative) throw new Error("Missing initiative");
      const trimmed = notes.trim();
      if (trimmed.length > 2000) {
        throw new Error("Notes must be ≤ 2000 characters.");
      }
      return recovery.completeInitiative(initiative.id, {
        brandId,
        ...(trimmed ? { completionNotes: trimmed } : {}),
      });
    },
    onSuccess: async () => {
      toast.success("Initiative marked complete");
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
          <DialogTitle className="font-serif">Mark initiative complete</DialogTitle>
          <DialogDescription>
            {initiative ? (
              <>
                Completing <span className="font-medium text-ink">{initiative.name}</span>{" "}
                schedules the 14-day actual-impact comparison and removes it
                from the active ribbon. The marker stays on the burn-down chart.
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
            <Label htmlFor="completion-notes">Completion notes (optional)</Label>
            <Textarea
              id="completion-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was the final scope? Any follow-ups?"
              rows={4}
              maxLength={2000}
            />
            <p className="text-[11px] text-ink-muted">
              {notes.trim().length}/2000
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
            <Button type="submit" disabled={mutation.isPending || !initiative}>
              {mutation.isPending ? "Completing…" : "Mark complete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
