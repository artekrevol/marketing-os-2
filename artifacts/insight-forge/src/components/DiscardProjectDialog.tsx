import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirmation modal for permanently discarding a project.
 * Replaces native `window.confirm` so we get a real, styled, accessible dialog
 * and can spell out exactly what gets deleted (research, outline, draft).
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <DiscardProjectDialog open={open} onOpenChange={setOpen} onConfirm={doDelete} loading={deleting} />
 */
export function DiscardProjectDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
  topic,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  topic?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this project?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
            {topic ? (
              <span className="block mb-2 [overflow-wrap:anywhere] break-words">
                &ldquo;<span className="text-ink">{topic}</span>&rdquo; will be permanently deleted.
              </span>
            ) : null}
              <span className="block">
                This action cannot be undone. All research, outline, and draft data will be permanently deleted.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Discarding…" : "Discard permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}