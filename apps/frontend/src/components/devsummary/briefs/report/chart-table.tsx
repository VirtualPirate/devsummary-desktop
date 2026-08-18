import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface ChartTableRow {
  key: string;
  /** First cell is the row header; the rest are figures, right-aligned. */
  cells: ReactNode[];
}

/** First column labels the row, everything after it is a number. */
function align(index: number): string {
  return index === 0 ? "text-left" : "text-right tabular-nums";
}

/**
 * Every chart carries a collapsed table of its own numbers. A stacked column
 * chart is unreadable to a screen reader and unusable to anyone who wants the
 * exact figure; this is the equivalent, not a nicety.
 */
export function ChartTable({
  caption,
  columns,
  rows,
  footer,
}: {
  caption: string;
  columns: string[];
  rows: ChartTableRow[];
  /** Optional summary row, rendered in a `<tfoot>` and set apart. */
  footer?: ReactNode[];
}) {
  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {caption}
      </summary>
      <div className="mt-3 overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40">
              {columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={`px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground ${align(i)}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-t transition-colors hover:bg-muted/30"
              >
                {row.cells.map((cell, i) =>
                  i === 0 ? (
                    <th
                      key={i}
                      scope="row"
                      className="whitespace-nowrap px-3 py-2 text-left font-normal text-muted-foreground"
                    >
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className={`px-3 py-2 ${align(i)}`}>
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
          {footer ? (
            <tfoot>
              <tr className="border-t-2 bg-muted/20 font-medium">
                {footer.map((cell, i) =>
                  i === 0 ? (
                    <th
                      key={i}
                      scope="row"
                      className="whitespace-nowrap px-3 py-2 text-left"
                    >
                      {cell}
                    </th>
                  ) : (
                    <td
                      key={i}
                      className={`whitespace-nowrap px-3 py-2 ${align(i)}`}
                    >
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </details>
  );
}
