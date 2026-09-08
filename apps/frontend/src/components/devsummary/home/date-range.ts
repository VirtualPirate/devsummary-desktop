import {
  type ActivityRange,
  type ActivitySelection,
  isCustomRange,
} from "@/lib/activity-window";
import { formatDateKey, keyOf } from "@/lib/calendar-grid";

export const PRESET_LABELS: Record<ActivityRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last year",
};

export function todayKey(): string {
  const now = new Date();
  return keyOf(now.getFullYear(), now.getMonth(), now.getDate());
}

export function rangeLabel(sel: ActivitySelection): string {
  if (!isCustomRange(sel)) return PRESET_LABELS[sel.range];
  const sameYear = sel.from.slice(0, 4) === sel.to.slice(0, 4);
  const opts = sameYear
    ? undefined
    : ({ month: "short", day: "numeric", year: "numeric" } as const);
  return `${formatDateKey(sel.from, opts)} – ${formatDateKey(sel.to, opts)}`;
}

/** Which end a click sets: a fresh pair starts over, otherwise the click
 * either closes the range or, when it lands before the start, becomes the
 * new start. Nobody has to know to click "earliest first". */
export function nextDraft(
  draft: { from: string; to: string },
  key: string,
): { from: string; to: string } {
  if (!draft.from || draft.to) return { from: key, to: "" };
  return key < draft.from ? { from: key, to: "" } : { from: draft.from, to: key };
}
