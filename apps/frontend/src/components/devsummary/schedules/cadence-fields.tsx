import type { CadenceInput } from "@launchstack/api-interfaces";
import { cadenceSentence, ordinal } from "@/lib/cadence-label";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const CADENCE_TYPES: { value: CadenceInput["type"]; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export function CadenceFields({
  cadence,
  timezone,
  onCadenceChange,
  onTimezoneChange,
}: {
  cadence: CadenceInput;
  timezone: string;
  onCadenceChange: (next: CadenceInput) => void;
  onTimezoneChange: (next: string) => void;
}) {
  const timezones = (() => {
    type SupportedValues = (kind: "timeZone") => string[];
    const intlWithSupported = Intl as unknown as { supportedValuesOf?: SupportedValues };
    return intlWithSupported.supportedValuesOf?.("timeZone") ?? ["UTC"];
  })();

  const selectType = (v: CadenceInput["type"]) => {
    const time = cadence.time;
    if (v === "daily") onCadenceChange({ type: "daily", time });
    else if (v === "weekly") onCadenceChange({ type: "weekly", time, dayOfWeek: 1 });
    else onCadenceChange({ type: "monthly", time, dayOfMonth: 1 });
  };

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs">How often</Label>
        <div className="mt-2 flex w-full gap-1 rounded-full border bg-card p-1">
          {CADENCE_TYPES.map(({ value, label }) => {
            const active = cadence.type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => selectType(value)}
                aria-pressed={active}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition",
                  active
                    ? "bg-brand/12 text-brand"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cadence-time" className="text-xs">
            Time of day
          </Label>
          <Input
            id="cadence-time"
            type="time"
            className="mt-1.5 tabular-nums"
            value={cadence.time}
            onChange={(e) =>
              onCadenceChange({ ...cadence, time: e.target.value } as CadenceInput)
            }
          />
        </div>
        <div>
          <Label htmlFor="cadence-tz" className="text-xs">
            Timezone
          </Label>
          <Select value={timezone} onValueChange={onTimezoneChange}>
            <SelectTrigger id="cadence-tz" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {cadence.type === "weekly" ? (
        <div>
          <Label className="text-xs">Which day</Label>
          <Select
            value={String(cadence.dayOfWeek)}
            onValueChange={(v) =>
              onCadenceChange({ ...cadence, dayOfWeek: Number(v) })
            }
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OF_WEEK.map((d) => (
                <SelectItem key={d.value} value={String(d.value)}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {cadence.type === "monthly" ? (
        <div>
          <Label className="text-xs">Which day of the month</Label>
          <Select
            value={String(cadence.dayOfMonth)}
            onValueChange={(v) =>
              onCadenceChange({ ...cadence, dayOfMonth: Number(v) })
            }
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {ordinal(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Months shorter than this fall back to their last day.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
        {cadenceSentence(cadence, timezone)}
      </div>
    </div>
  );
}
