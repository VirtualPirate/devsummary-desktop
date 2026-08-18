export const chartAxisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
} as const;

export const chartTooltipStyle = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

export function formatDateTick(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Tooltip labelFormatter-compatible wrapper (recharts passes ReactNode). */
export function formatDateTickLabel(label: unknown): string {
  return typeof label === "string" ? formatDateTick(label) : "";
}

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompact(n: number): string {
  return compact.format(n);
}

export function formatSignedCompact(n: number): string {
  return `${n >= 0 ? "+" : "−"}${compact.format(Math.abs(n))}`;
}
