import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Animated, infinitely-looping DevSummary mark for loading states.
 *
 * The Converge concept, in motion: commit activity streams down the ink funnel
 * (dashed flow), the accent node pulses as it resolves the work, and the brief
 * ships out on the right. One ~1.8s cycle, loops forever.
 *
 * Static (no animation) when the user prefers reduced motion.
 */
export function BrandMarkLoader({ className }: { className?: string }) {
  // Scope keyframes/animation names per instance so nothing leaks globally and
  // multiple loaders on one page never collide.
  const raw = useId();
  const ns = `dsl-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <svg
      viewBox="9 23 82 54"
      className={cn("h-6 w-auto shrink-0", className)}
      fill="none"
      role="img"
      aria-label="Loading"
    >
      <style>{`
        .${ns}-flow {
          stroke-dasharray: 5 9;
          animation: ${ns}-flow 0.9s linear infinite;
        }
        .${ns}-dot {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${ns}-dot 1.8s ease-in-out infinite;
        }
        .${ns}-dot-2 { animation-delay: 0.15s; }
        .${ns}-dot-3 { animation-delay: 0.30s; }
        .${ns}-node {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${ns}-node 1.8s ease-in-out infinite;
        }
        .${ns}-halo {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${ns}-halo 1.8s ease-out infinite;
        }
        .${ns}-ship {
          transform-box: fill-box;
          transform-origin: left center;
          animation: ${ns}-ship 1.8s ease-in-out infinite;
        }
        @keyframes ${ns}-flow { to { stroke-dashoffset: -14; } }
        @keyframes ${ns}-dot {
          0%, 100% { opacity: 0.35; transform: scale(0.65); }
          45%      { opacity: 1;    transform: scale(1); }
        }
        @keyframes ${ns}-node {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.09); }
        }
        @keyframes ${ns}-halo {
          0%        { transform: scale(1);   opacity: 0.5; }
          70%, 100% { transform: scale(2.1); opacity: 0; }
        }
        @keyframes ${ns}-ship {
          0%, 100% { opacity: 0.3; transform: translateX(-3px) scaleX(0.82); }
          40%      { opacity: 1;   transform: translateX(0)    scaleX(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .${ns}-flow, .${ns}-dot, .${ns}-node, .${ns}-halo, .${ns}-ship {
            animation: none;
          }
          .${ns}-flow { stroke-dasharray: none; }
          .${ns}-halo { opacity: 0; }
          .${ns}-ship { opacity: 1; }
        }
      `}</style>

      {/* Ink funnel — commit activity streaming toward the node */}
      <g className={`${ns}-flow`} stroke="var(--foreground)" strokeWidth={4} strokeLinecap="round">
        <path d="M18 31 Q37 33 43 47" />
        <path d="M19 50 L41 50" />
        <path d="M18 69 Q37 67 43 53" />
      </g>

      {/* Input dots — incoming commits, staggered */}
      <g fill="var(--foreground)">
        <circle className={`${ns}-dot`} cx={15} cy={30} r={4} />
        <circle className={`${ns}-dot ${ns}-dot-2`} cx={15} cy={50} r={4} />
        <circle className={`${ns}-dot ${ns}-dot-3`} cx={15} cy={70} r={4} />
      </g>

      {/* Node — pulsing halo + core, resolving the work */}
      <circle className={`${ns}-halo`} cx={49} cy={50} r={8} fill="none" stroke="var(--brand)" strokeWidth={2} />
      <circle className={`${ns}-node`} cx={49} cy={50} r={8} fill="none" stroke="var(--brand)" strokeWidth={5} />

      {/* Brief shipping out */}
      <g className={`${ns}-ship`}>
        <line x1={57} y1={50} x2={62} y2={50} stroke="var(--brand)" strokeWidth={4} strokeLinecap="round" />
        <rect x={63} y={45} width={26} height={10} rx={5} fill="var(--brand)" />
      </g>
    </svg>
  );
}

/**
 * Full-viewport centered loading screen built on {@link BrandMarkLoader}.
 * Drop in as a route-level fallback while data or the app shell boots.
 */
export function BrandLoadingScreen({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex min-h-svh flex-col items-center justify-center gap-4", className)}
      role="status"
      aria-live="polite"
    >
      <BrandMarkLoader className="h-12" />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : null}
      <span className="sr-only">Loading</span>
    </div>
  );
}
