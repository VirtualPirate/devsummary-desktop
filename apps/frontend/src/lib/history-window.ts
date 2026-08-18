import type { GithubLookbackDays } from "@launchstack/api-interfaces";

/** How far back the first ingest reads. One window per batch, not per repo. */
export const HISTORY_WINDOWS: Array<{
  days: GithubLookbackDays;
  label: string;
  hint: string;
}> = [
  { days: 30, label: "Last 30 days", hint: "Fastest — good for trying it out" },
  {
    days: 90,
    label: "Last 90 days",
    hint: "Default — one quarter, the most history we read",
  },
];

export function historyWindowLabel(days: GithubLookbackDays): string {
  return (
    HISTORY_WINDOWS.find((w) => w.days === days)?.label ?? `Last ${days} days`
  );
}
