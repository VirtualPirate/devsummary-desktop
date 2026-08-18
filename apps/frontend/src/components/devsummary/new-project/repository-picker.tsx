import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, GitBranch } from "lucide-react";
import type { Project } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { useSetProjectRepositories } from "@/hooks/api/use-projects";

export function RepositoryPicker({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}) {
  const installationsQuery = useGithubInstallations();
  const mutation = useSetProjectRepositories(project.id);

  const allRepos = useMemo(() => {
    return (installationsQuery.data?.data ?? []).flatMap((i) =>
      i.repositories.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        accountLogin: i.accountLogin,
        // No branch chosen = no commits read, so this repository contributes
        // nothing to the project's briefs. Selectable anyway (a project is a
        // grouping, and a branch can be chosen afterwards) but it has to say so.
        unconfigured: r.branch === null,
      })),
    );
  }, [installationsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set(project.repositoryIds));
  const [search, setSearch] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set(project.repositoryIds));
      setSearch("");
      setSubmitError(null);
    }
  }, [open, project.repositoryIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredRepos = allRepos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSave = async () => {
    setSubmitError(null);
    try {
      await mutation.mutateAsync({ repositoryIds: Array.from(selected) });
      toast.success("Repositories updated");
      onOpenChange(false);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage repositories</DialogTitle>
          <DialogDescription>
            Choose the repositories that belong to {project.name}.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search repositories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {installationsQuery.isError ? (
          <ErrorState
            message={extractErrorMessage(installationsQuery.error)}
            onRetry={() => installationsQuery.refetch()}
          />
        ) : (
          <ScrollArea className="h-72 rounded-xl border">
            {filteredRepos.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-muted-foreground">
                No repositories match your search.
              </p>
            ) : (
              <ul className="space-y-0.5 p-1.5">
                {filteredRepos.map((r) => {
                  const isSel = selected.has(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => toggle(r.id)}
                        aria-pressed={isSel}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          isSel ? "bg-brand/12 text-brand" : "hover:bg-muted/60",
                        )}
                      >
                        <GitBranch
                          className={cn(
                            "size-4 shrink-0",
                            isSel ? "text-brand" : "text-muted-foreground",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {r.fullName}
                        </span>
                        {r.unconfigured ? (
                          <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                            No branch chosen
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "shrink-0 truncate text-xs",
                            isSel ? "text-brand/80" : "text-muted-foreground",
                          )}
                        >
                          {r.accountLogin}
                        </span>
                        {isSel ? <Check className="size-4 shrink-0" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        )}

        {submitError ? <p className="text-xs text-destructive">{submitError}</p> : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={mutation.isPending}>
            Save {selected.size} repositor{selected.size === 1 ? "y" : "ies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
