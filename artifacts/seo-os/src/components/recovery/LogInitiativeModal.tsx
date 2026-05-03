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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recovery, type RecoveryInitiative } from "@/lib/api";
import {
  INITIATIVE_TYPES,
  fromDatetimeLocal,
  toDatetimeLocal,
} from "./initiative-form";

/**
 * Modal for both creating a new initiative ("Log initiative" ribbon
 * button) and editing an existing one (from InitiativeDetailModal →
 * Edit). Mode is controlled by the `mode` prop:
 *
 *  - `"create"`: blank form, calls `POST /api/recovery/initiatives`.
 *  - `"edit"`:   prefilled from `initiative`, calls `PUT
 *                /api/recovery/initiatives/:id`.
 */
export function LogInitiativeModal({
  open,
  onOpenChange,
  brandId,
  mode,
  initiative,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  brandId: string;
  mode: "create" | "edit";
  initiative?: RecoveryInitiative;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("content_refresh");
  const [description, setDescription] = useState("");
  const [expectedImpactPct, setExpectedImpactPct] = useState<string>("");
  const [expectedImpactClicks, setExpectedImpactClicks] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string>(toDatetimeLocal(null));
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the modal is (re)opened. We deliberately reset
  // even on close→open so a cancelled "edit" of one card does not
  // bleed into a fresh "create" launched right after.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && initiative) {
      setName(initiative.name);
      setType(initiative.type);
      setDescription(initiative.description ?? "");
      setExpectedImpactPct(
        initiative.expected_impact_pct != null
          ? String(initiative.expected_impact_pct)
          : "",
      );
      setExpectedImpactClicks(
        initiative.expected_impact_clicks != null
          ? String(initiative.expected_impact_clicks)
          : "",
      );
      setStartedAt(toDatetimeLocal(initiative.started_at));
    } else {
      setName("");
      setType("content_refresh");
      setDescription("");
      setExpectedImpactPct("");
      setExpectedImpactClicks("");
      setStartedAt(toDatetimeLocal(null));
    }
  }, [open, mode, initiative]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Trimmed copy used both for validation and the network call —
      // avoids "looks valid in the input but the server rejects" when
      // a user pads the name with whitespace.
      const trimmedName = name.trim();
      if (trimmedName.length < 5 || trimmedName.length > 100) {
        throw new Error("Name must be 5–100 characters.");
      }
      const pct =
        expectedImpactPct.trim() === "" ? null : Number(expectedImpactPct);
      if (pct != null && (Number.isNaN(pct) || pct < 0 || pct > 200)) {
        throw new Error("Expected impact % must be 0–200.");
      }
      const clicks =
        expectedImpactClicks.trim() === ""
          ? null
          : Number(expectedImpactClicks);
      if (clicks != null && (!Number.isInteger(clicks) || clicks < 0)) {
        throw new Error("Expected clicks must be a non-negative integer.");
      }
      const desc = description.trim() === "" ? null : description.trim();
      const payload = {
        brandId,
        name: trimmedName,
        type,
        description: desc,
        expectedImpactPct: pct,
        expectedImpactClicks: clicks,
        startedAt: fromDatetimeLocal(startedAt),
      };
      if (mode === "create") {
        return recovery.createInitiative(payload);
      }
      if (!initiative) throw new Error("Missing initiative for edit");
      return recovery.updateInitiative(initiative.id, payload);
    },
    onSuccess: async () => {
      toast.success(
        mode === "create" ? "Initiative logged" : "Initiative updated",
      );
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {mode === "create" ? "Log recovery initiative" : "Edit initiative"}
          </DialogTitle>
          <DialogDescription>
            Track recovery work so the burn-down chart marks when each change
            shipped. Expected impact is optional but helps grade outcomes
            after the 14-day actual-impact window closes.
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
            <Label htmlFor="initiative-name">Name</Label>
            <Input
              id="initiative-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Refresh top-10 product comparisons"
              maxLength={100}
              required
            />
            <p className="text-[11px] text-ink-muted">
              {name.trim().length}/100 — minimum 5
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="initiative-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="initiative-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INITIATIVE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="initiative-started-at">Started at</Label>
              <Input
                id="initiative-started-at"
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="initiative-description">Description (optional)</Label>
            <Textarea
              id="initiative-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What changed and why?"
              rows={3}
              maxLength={4000}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="initiative-pct">Expected impact %</Label>
              <Input
                id="initiative-pct"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                max={200}
                value={expectedImpactPct}
                onChange={(e) => setExpectedImpactPct(e.target.value)}
                placeholder="e.g. 12.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="initiative-clicks">Expected clicks</Label>
              <Input
                id="initiative-clicks"
                type="number"
                inputMode="numeric"
                step="1"
                min={0}
                value={expectedImpactClicks}
                onChange={(e) => setExpectedImpactClicks(e.target.value)}
                placeholder="e.g. 500"
              />
            </div>
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
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Saving…"
                : mode === "create"
                  ? "Log initiative"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
