import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import type { Team } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useSetTeamCollaborators } from "@/hooks/api/use-teams";

export function CollaboratorPicker({
  open,
  onOpenChange,
  team,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: Team;
}) {
  const collaboratorsQuery = useGetCollaborators();
  const mutation = useSetTeamCollaborators(team.id);

  const [selected, setSelected] = useState<Set<string>>(new Set(team.collaboratorIds));
  const [search, setSearch] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set(team.collaboratorIds));
      setSearch("");
      setSubmitError(null);
    }
  }, [open, team.collaboratorIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const all = collaboratorsQuery.data?.data ?? [];
  const filtered = all.filter((c) =>
    c.login.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSave = async () => {
    setSubmitError(null);
    try {
      await mutation.mutateAsync({ collaboratorIds: Array.from(selected) });
      toast.success("Collaborators updated");
      onOpenChange(false);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage collaborators</DialogTitle>
          <DialogDescription>
            Pick GitHub collaborators reachable from your org.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search by login…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {collaboratorsQuery.isError ? (
          <ErrorState
            message={extractErrorMessage(collaboratorsQuery.error)}
            onRetry={() => collaboratorsQuery.refetch()}
          />
        ) : (
          <ScrollArea className="h-72 rounded-xl border">
            {filtered.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-muted-foreground">
                {collaboratorsQuery.isLoading
                  ? "Loading…"
                  : "No collaborators match your search."}
              </p>
            ) : (
              <ul className="space-y-0.5 p-1.5">
                {filtered.map((c) => {
                  const isSel = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        aria-pressed={isSel}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          isSel ? "bg-brand/12 text-brand" : "hover:bg-muted/60",
                        )}
                      >
                        <Avatar className="size-7">
                          {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt={c.login} /> : null}
                          <AvatarFallback className="text-[10px]">
                            {c.login.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.login}
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
            Save {selected.size} collaborator{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
