import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateProject,
  useUpdateProject,
} from "@/hooks/api/use-projects";
import { extractErrorMessage } from "@/components/devsummary/shared/error-state";

const COLORS = [
  "oklch(0.62 0.22 305)",
  "oklch(0.62 0.18 277)",
  "oklch(0.6 0.16 200)",
  "oklch(0.65 0.18 140)",
  "oklch(0.7 0.18 85)",
  "oklch(0.68 0.2 30)",
];

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  onSaved?: (p: Project) => void;
}) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setColor(project?.color ?? COLORS[0]);
    setSubmitError(null);
  }, [open, project]);

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject(project?.id ?? "");
  const submitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    try {
      if (isEdit && project) {
        const res = await updateMutation.mutateAsync({
          name: name.trim(),
          description: description.trim() || null,
          color,
        });
        toast.success("Project updated");
        onSaved?.(res.data);
      } else {
        const res = await createMutation.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          repositoryIds: [],
        });
        toast.success("Project created");
        onSaved?.(res.data);
      }
      onOpenChange(false);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
            <DialogDescription>
              Group repositories so briefs cover the right scope.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold",
                  color ? "text-white" : "bg-muted text-muted-foreground",
                )}
                style={color ? { background: color } : undefined}
              >
                {(name || "P").trim().charAt(0).toUpperCase() || "P"}
              </span>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      "size-7 rounded-full ring-offset-2 ring-offset-background transition",
                      color === c ? "ring-2 ring-ring" : "hover:scale-110",
                    )}
                    style={{ background: c }}
                    aria-label={`Color ${i + 1}`}
                    aria-pressed={color === c}
                  />
                ))}
              </div>
            </div>
          </div>

          {submitError ? (
            <p className="text-xs text-destructive">{submitError}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {isEdit ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
