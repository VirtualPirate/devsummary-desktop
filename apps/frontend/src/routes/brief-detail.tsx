import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { BriefViewer } from "@/components/devsummary/briefs/brief-viewer";
import { OneOffBadge } from "@/components/devsummary/briefs/one-off-badge";
import {
  useDeleteBrief,
  useGenerateBrief,
  useGetBrief,
} from "@/hooks/api/use-briefs";

/** `/briefs` declares its filters as required search params. */
const BRIEFS_LIST_SEARCH = {
  filterType: "all",
  from: "",
  to: "",
  scopeId: "",
  excludeNoActivity: false,
  page: 0,
} as const;

export function BriefDetailPage() {
  const { briefId } = useParams({ strict: false });
  const navigate = useNavigate();
  const briefQuery = useGetBrief(briefId);
  const generateMutation = useGenerateBrief();
  const deleteMutation = useDeleteBrief();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (briefQuery.isLoading) {
    return (
      <>
        <BackLink />
        <SkeletonList rows={4} rowHeight={60} />
      </>
    );
  }
  if (briefQuery.isError || !briefQuery.data?.data) {
    return (
      <>
        <BackLink />
        <ErrorState
          message={extractErrorMessage(briefQuery.error)}
          onRetry={() => briefQuery.refetch()}
        />
      </>
    );
  }

  const brief = briefQuery.data.data;
  // Only hand-generated briefs are deletable — a scheduled one would be
  // recreated by its schedule, so the backend refuses it (409).
  const isOneOff = brief.briefScheduleId === null;

  const handleRetry = async () => {
    if (!brief.scope) return;
    const scopeInput = (() => {
      const s = brief.scope;
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
      const res = await generateMutation.mutateAsync({
        scope: scopeInput,
        periodStart: brief.periodStart,
        periodEnd: brief.periodEnd,
        // The original's zone, not the viewer's: a regenerated brief must tile
        // the same days as the one it replaces.
        timezone: brief.periodTimezone,
      });
      toast.success("Brief regeneration enqueued");
      await navigate({
        to: "/briefs/$briefId",
        params: { briefId: res.data.briefId },
      });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(brief.id);
      toast.success("Brief deleted");
      await navigate({ to: "/briefs", search: BRIEFS_LIST_SEARCH });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <BackLink />
        {isOneOff ? (
          <div className="flex items-center gap-2">
            <OneOffBadge />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        ) : null}
      </div>

      <BriefViewer brief={brief} onRetry={handleRetry} />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this brief?</AlertDialogTitle>
            <AlertDialogDescription>
              This one-off brief will be removed from your briefs list. Nothing
              will regenerate it, and this can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BackLink() {
  return (
    <Link
      to="/briefs"
      search={BRIEFS_LIST_SEARCH}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3" /> Back to briefs
    </Link>
  );
}
