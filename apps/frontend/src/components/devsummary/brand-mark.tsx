import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="9 23 82 54"
      className={cn("h-[20px] w-auto shrink-0", className)}
      fill="none"
      role="img"
      aria-label="DevSummary"
    >
      {/* Converge mark: ink funnel (commit activity) resolving into the accent brief. */}
      <g stroke="var(--foreground)" strokeWidth={4} strokeLinecap="round">
        <path d="M18 31 Q37 33 43 47" />
        <path d="M19 50 L41 50" />
        <path d="M18 69 Q37 67 43 53" />
      </g>
      <g fill="var(--foreground)">
        <circle cx={15} cy={30} r={4} />
        <circle cx={15} cy={50} r={4} />
        <circle cx={15} cy={70} r={4} />
      </g>
      <circle cx={49} cy={50} r={8} fill="none" stroke="var(--brand)" strokeWidth={5} />
      <line x1={57} y1={50} x2={62} y2={50} stroke="var(--brand)" strokeWidth={4} strokeLinecap="round" />
      <rect x={63} y={45} width={26} height={10} rx={5} fill="var(--brand)" />
    </svg>
  );
}
