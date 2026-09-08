import { useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ACTIVITY_RANGES,
  type ActivityRange,
  type ActivitySelection,
  isCustomRange,
} from "@/lib/activity-window";
import {
  addDaysKey,
  calendarMonth,
  daysBetween,
  formatDateKey,
  WEEKDAY_INITIALS,
} from "@/lib/calendar-grid";
import { cn } from "@/lib/utils";
import { nextDraft, PRESET_LABELS, rangeLabel, todayKey } from "./date-range";

export function DateRangePicker({
  value,
  onChange,
}: {
  value: ActivitySelection;
  onChange: (next: ActivitySelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [hovered, setHovered] = useState("");
  const today = todayKey();

  // The left month of the pair. Opening on a custom range lands on its start.
  const [anchor, setAnchor] = useState(() => today.slice(0, 7));
  const [focusKey, setFocusKey] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

  const months = useMemo(() => {
    const [y, m] = anchor.split("-").map(Number);
    return [calendarMonth(y, m - 1), calendarMonth(y, m)];
  }, [anchor]);

  const shiftAnchor = (by: number) => {
    const [y, m] = anchor.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setAnchor(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const openWith = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    const start = isCustomRange(value) ? value.from : "";
    setDraft(isCustomRange(value) ? { from: value.from, to: value.to } : { from: "", to: "" });
    setHovered("");
    setFocusKey(start || today);
    // Show the range's own months, with its start on the left.
    setAnchor((start || today).slice(0, 7));
  };

  const applyPreset = (range: ActivityRange) => {
    onChange({ range, from: "", to: "" });
    setOpen(false);
  };

  // The hovered day previews the closing half of the range before it is clicked.
  const previewEnd = draft.from && !draft.to && hovered > draft.from ? hovered : draft.to;

  const inRange = (key: string) =>
    !!draft.from && !!previewEnd && key > draft.from && key < previewEnd;
  const isEnd = (key: string) => key === draft.from || key === previewEnd;

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowLeft" ? -1
      : e.key === "ArrowRight" ? 1
      : e.key === "ArrowUp" ? -7
      : e.key === "ArrowDown" ? 7
      : e.key === "PageUp" ? -28
      : e.key === "PageDown" ? 28
      : 0;
    if (!step) return;
    e.preventDefault();
    const next = addDaysKey(focusKey || today, step);
    if (next > today) return;
    setFocusKey(next);
    const nextMonth = next.slice(0, 7);
    const leftMonth = `${months[0].year}-${String(months[0].month + 1).padStart(2, "0")}`;
    const rightMonth = `${months[1].year}-${String(months[1].month + 1).padStart(2, "0")}`;
    if (nextMonth < leftMonth) shiftAnchor(-1);
    else if (nextMonth > rightMonth) shiftAnchor(1);
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)
        ?.focus();
    });
  };

  const span = draft.from && draft.to ? daysBetween(draft.from, draft.to) + 1 : 0;

  return (
    <Popover open={open} onOpenChange={openWith}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 rounded-full px-3.5 text-xs font-medium shadow-e1"
        >
          <CalendarDays className="size-3.5 text-muted-foreground" />
          {rangeLabel(value)}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto gap-0 p-0">
        <div className="flex">
          <div className="flex w-[140px] shrink-0 flex-col gap-0.5 border-r p-2">
            {ACTIVITY_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => applyPreset(r)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                  !isCustomRange(value) && value.range === r
                    ? "bg-brand/12 text-brand"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {PRESET_LABELS[r]}
              </button>
            ))}
          </div>

          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => shiftAnchor(-1)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="flex flex-1 justify-around text-xs font-medium">
                {months.map((m) => (
                  <span key={m.label}>{m.label}</span>
                ))}
              </div>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => shiftAnchor(1)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div
              ref={gridRef}
              className="flex gap-4"
              onKeyDown={onGridKeyDown}
              onMouseLeave={() => setHovered("")}
            >
              {months.map((m) => (
                <table key={m.label} className="border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {WEEKDAY_INITIALS.map((w, i) => (
                        <th
                          key={i}
                          scope="col"
                          className="size-8 text-[11px] font-normal text-muted-foreground"
                        >
                          {w}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.weeks.map((week, wi) => (
                      <tr key={wi}>
                        {week.map((key, di) => {
                          if (!key) return <td key={di} className="size-8" />;
                          const disabled = key > today;
                          const end = isEnd(key);
                          const middle = inRange(key);
                          return (
                            <td
                              key={di}
                              className={cn(
                                "size-8 p-0",
                                middle && "bg-brand/10",
                                end && draft.to && key === draft.from && "rounded-l-md bg-brand/10",
                                end && draft.from && key === previewEnd && draft.from !== previewEnd && "rounded-r-md bg-brand/10",
                              )}
                            >
                              <button
                                type="button"
                                data-day={key}
                                disabled={disabled}
                                tabIndex={key === (focusKey || today) ? 0 : -1}
                                onFocus={() => setFocusKey(key)}
                                onMouseEnter={() => setHovered(key)}
                                onClick={() => setDraft(nextDraft(draft, key))}
                                className={cn(
                                  "size-8 rounded-md text-xs tabular-nums transition-colors",
                                  "focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none",
                                  disabled && "text-muted-foreground/40",
                                  !disabled && !end && "hover:bg-muted",
                                  end && "bg-brand font-medium text-brand-foreground",
                                  !end && key === today && "font-semibold text-brand",
                                )}
                              >
                                {Number(key.slice(8))}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {draft.from && draft.to
                  ? `${formatDateKey(draft.from)} – ${formatDateKey(draft.to)} · ${span} day${span === 1 ? "" : "s"}`
                  : draft.from
                    ? "Pick an end date"
                    : "Pick a start date"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={!draft.from || !draft.to}
                  onClick={() => {
                    onChange({ ...value, from: draft.from, to: draft.to });
                    setOpen(false);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
