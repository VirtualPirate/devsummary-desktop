import { toast } from "sonner";
import type { BriefResponse } from "@launchstack/api-interfaces";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractErrorMessage } from "@/components/devsummary/shared/error-state";
import { BriefViewer } from "./brief-viewer";
import { useGenerateBrief, useGetBrief } from "@/hooks/api/use-briefs";

export function BriefDetailDialog({
  brief,
  open,
  onOpenChange,
}: {
  brief: BriefResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const briefQuery = useGetBrief(open ? brief?.id : undefined);
  const generateMutation = useGenerateBrief();

  // Render the already-known list item immediately (no loading flash); swap to
  // fresh data once useGetBrief resolves (and keeps polling pending/generating).
  const data = briefQuery.data?.data ?? brief;

  const handleRetry = async () => {
    if (!data?.scope) return;
    const scopeInput = (() => {
      const s = data.scope;
      if (s.type === "project" && s.projectId)
        return { type: "project" as const, projectId: s.projectId };
      if (s.type === "team" && s.teamId)
        return { type: "team" as const, teamId: s.teamId };
      if (s.type === "collaborator" && s.collaboratorId)
        return {
          type: "collaborator" as const,
          collaboratorId: s.collaboratorId,
        };
      if (s.type === "repository" && s.repositoryId)
        return { type: "repository" as const, repositoryId: s.repositoryId };
      return null;
    })();
    if (!scopeInput) {
      toast.error("Can't retry — the brief's scope entity was deleted.");
      return;
    }
    try {
      await generateMutation.mutateAsync({
        scope: scopeInput,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        // The original's zone, not the viewer's: a regenerated brief must tile
        // the same days as the one it replaces.
        timezone: data.periodTimezone,
      });
      toast.success("Brief regeneration enqueued");
      onOpenChange(false);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto p-6 sm:p-8">
        <DialogTitle className="sr-only">{data?.title || "Brief"}</DialogTitle>
        <DialogDescription className="sr-only">
          Brief details
        </DialogDescription>
        {data ? <BriefViewer brief={data} onRetry={handleRetry} bare /> : null}
      </DialogContent>
    </Dialog>
  );
}
