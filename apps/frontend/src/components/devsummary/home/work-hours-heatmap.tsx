import type { CommitHoursCell } from "@launchstack/api-interfaces";
import { workHoursGrid } from "./work-hours";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_LABELS = [0, 6, 12, 18];

/** Six sequential steps of one hue over the card, so the ramp reads the same
 * in light and dark without a second token set. Step 0 is "no commits" and is
 * drawn as an outline only. */
const RAMP = [0, 20, 36, 52, 70, 92];

function stepOf(value: number, max: number): number {
  if (value === 0) return 0;
  return Math.min(5, 1 + Math.floor((value / max) * 4.999));
}

function swatchStyle(step: number) {
  return step === 0
    ? undefined
    : {
        backgroundColor: `color-mix(in oklch, var(--gb-chart-feature) ${RAMP[step]}%, var(--card))`,
      };
}

function hourLabel(h: number): string {
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

const CELL = "rounded-[2px] h-3";
const EMPTY = "border border-border";

export function WorkHoursHeatmap({ cells }: { cells: CommitHoursCell[] }) {
  const grid = workHoursGrid(cells);
  const max = Math.max(...grid.flat());

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "1.75rem repeat(24, minmax(0, 1fr))" }}
      >
        {grid.map((row, r) => (
          <div key={DAYS[r]} className="contents">
            <div className="flex items-center justify-end pr-1 text-[11px] text-muted-foreground">
              {DAYS[r]}
            </div>
            {row.map((v, h) => {
              const step = stepOf(v, max);
              return (
                <div
                  key={h}
                  className={`${CELL} ${step === 0 ? EMPTY : ""}`}
                  style={swatchStyle(step)}
                  title={`${DAYS[r]} ${String(h).padStart(2, "0")}:00 · ${v} commit${v === 1 ? "" : "s"}`}
                />
              );
            })}
          </div>
        ))}

        <div />
        {HOUR_LABELS.map((h) => (
          <div
            key={h}
            className="col-span-6 pt-1 text-[11px] text-muted-foreground"
          >
            {hourLabel(h)}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        fewer
        {RAMP.map((_, step) => (
          <span
            key={step}
            className={`inline-block size-3 rounded-[2px] ${step === 0 ? EMPTY : ""}`}
            style={swatchStyle(step)}
          />
        ))}
        more
      </div>
    </div>
  );
}
