import {
  BRIEF_COMMIT_TYPES,
  type BriefCommitType,
} from "@launchstack/api-interfaces";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { cn } from "@/lib/utils";

export interface CommitFiltersValue {
  from: string; // "" or yyyy-mm-dd
  to: string; // "" or yyyy-mm-dd
  commitType: string; // "" or a BRIEF_COMMIT_TYPES value
  repo: string; // "" means every repository
  analyzedOnly: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export const EMPTY_COMMIT_FILTERS: CommitFiltersValue = {
  from: "",
  to: "",
  commitType: "",
  repo: "",
  analyzedOnly: true,
};

/** Anything the user changed away from the defaults. */
// eslint-disable-next-line react-refresh/only-export-components
export function hasActiveCommitFilters(v: CommitFiltersValue): boolean {
  return (
    !!v.from || !!v.to || !!v.commitType || !!v.repo || !v.analyzedOnly
  );
}

// Radix <SelectItem> forbids an empty-string value, so use sentinels for the
// "all" options and map them back to "" in the change handler.
const ANY_TYPE = "any";
const ALL_REPOS = "all";

export function CommitFilters({
  value,
  onChange,
  className,
}: {
  value: CommitFiltersValue;
  onChange: (next: CommitFiltersValue) => void;
  className?: string;
}) {
  const installationsQuery = useGithubInstallations();
  const repos = (installationsQuery.data?.data ?? []).flatMap((i) =>
    i.repositories.map((r) => ({ id: r.id, fullName: r.fullName })),
  );

  const set = (patch: Partial<CommitFiltersValue>) =>
    onChange({ ...value, ...patch });

  return (
    <section className={cn("rounded-lg border bg-card p-3", className)}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="commit-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="commit-from"
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
            className="h-8 w-[150px] text-xs"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="commit-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="commit-to"
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
            className="h-8 w-[150px] text-xs"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={value.commitType || ANY_TYPE}
            onValueChange={(v) =>
              set({ commitType: v === ANY_TYPE ? "" : (v as BriefCommitType) })
            }
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_TYPE}>All types</SelectItem>
              {BRIEF_COMMIT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Repository</Label>
          <Select
            value={value.repo || ALL_REPOS}
            onValueChange={(v) => set({ repo: v === ALL_REPOS ? "" : v })}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue placeholder="All repositories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_REPOS}>All repositories</SelectItem>
              {repos.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <Switch
            id="commit-analyzed-only"
            checked={value.analyzedOnly}
            onCheckedChange={(checked) => set({ analyzedOnly: checked })}
          />
          <Label
            htmlFor="commit-analyzed-only"
            className="text-xs text-muted-foreground"
          >
            Analyzed only
          </Label>
        </div>

        {hasActiveCommitFilters(value) ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_COMMIT_FILTERS })}
            className="pb-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );
}
