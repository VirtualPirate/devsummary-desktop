import type { Collaborator } from "@launchstack/api-interfaces";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIVITY_RANGES, type ActivityRange } from "@/lib/activity-window";
import { cn } from "@/lib/utils";

// Radix SelectItem forbids empty-string values, hence the "all" sentinel
// (same convention as brief-filters.tsx).
const ALL = "all";

export interface ActivityFiltersValue {
  range: ActivityRange;
  repo: string; // "" = all repositories
  collaborator: string; // "" = all collaborators
}

export function ActivityFilters({
  value,
  repos,
  collaborators,
  onChange,
}: {
  value: ActivityFiltersValue;
  repos: { id: string; fullName: string }[];
  collaborators: Collaborator[];
  onChange: (next: ActivityFiltersValue) => void;
}) {
  const set = (patch: Partial<ActivityFiltersValue>) =>
    onChange({ ...value, ...patch });

  const hasActive = !!value.repo || !!value.collaborator;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Repository</Label>
        <Select
          value={value.repo || ALL}
          onValueChange={(v) => set({ repo: v === ALL ? "" : v })}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="All repositories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All repositories</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Collaborator</Label>
        <Select
          value={value.collaborator || ALL}
          onValueChange={(v) => set({ collaborator: v === ALL ? "" : v })}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="All collaborators" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All collaborators</SelectItem>
            {collaborators.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.login}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasActive ? (
        <button
          type="button"
          onClick={() => set({ repo: "", collaborator: "" })}
          className="pb-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear filters
        </button>
      ) : null}

      <div className="ml-auto inline-flex gap-1 rounded-full border bg-card p-1 shadow-e1">
        {ACTIVITY_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => set({ range: r })}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              value.range === r
                ? "bg-brand/12 text-brand"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
