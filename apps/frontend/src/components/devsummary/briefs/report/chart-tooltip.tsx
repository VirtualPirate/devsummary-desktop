import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ChartTooltipContext,
  type ChartTooltipApi,
} from "./chart-tooltip-context";

interface TooltipState {
  title: string;
  lines: string[];
  x: number;
  y: number;
}

/**
 * One fixed-position tooltip shared by every chart in the report, rather than
 * one per mark. Charts have hundreds of marks; hundreds of absolutely
 * positioned nodes is the slow way to do this.
 */
export function ChartTooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TooltipState | null>(null);

  const show = useCallback(
    (title: string, lines: string[], target: Element) => {
      const r = target.getBoundingClientRect();
      setTip({ title, lines, x: r.left + r.width / 2, y: r.top - 8 });
    },
    [],
  );

  const api = useMemo<ChartTooltipApi>(
    () => ({
      bind: (title, ...lines) => ({
        onPointerEnter: (e) => show(title, lines, e.currentTarget),
        onPointerLeave: () => setTip(null),
        onFocus: (e) => show(title, lines, e.currentTarget),
        onBlur: () => setTip(null),
        tabIndex: 0,
      }),
    }),
    [show],
  );

  return (
    <ChartTooltipContext.Provider value={api}>
      {children}
      {tip ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-pre rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-e2"
          style={{ left: tip.x, top: tip.y }}
        >
          <b className="font-semibold">{tip.title}</b>
          {tip.lines.length > 0 ? `\n${tip.lines.join("\n")}` : null}
        </div>
      ) : null}
    </ChartTooltipContext.Provider>
  );
}
