import { createContext, useContext } from "react";
import type { FocusEvent, PointerEvent } from "react";

export interface ChartTooltipApi {
  /** Spread onto any chart element to give it a tooltip. */
  bind: (
    title: string,
    ...lines: string[]
  ) => {
    onPointerEnter: (e: PointerEvent<HTMLElement | SVGElement>) => void;
    onPointerLeave: () => void;
    onFocus: (e: FocusEvent<HTMLElement | SVGElement>) => void;
    onBlur: () => void;
    tabIndex: number;
  };
}

// Split from the provider so the component file exports components only —
// `react-refresh/only-export-components` treats a mixed file as an error.
export const ChartTooltipContext = createContext<ChartTooltipApi | null>(null);

export function useChartTooltip(): ChartTooltipApi {
  const api = useContext(ChartTooltipContext);
  if (!api) throw new Error("useChartTooltip outside ChartTooltipProvider");
  return api;
}
