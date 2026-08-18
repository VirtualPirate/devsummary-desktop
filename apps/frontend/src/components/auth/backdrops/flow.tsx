/**
 * Shared machinery for the flow backdrops: commits enter from the left as glowing
 * dots, travel a topology of legs, and leave on the right as the brief.
 *
 * A leg's `from`/`to` are fractions of the cycle, so a dot waits at the leg's start
 * until its turn, travels, then parks out of sight — that is what chains multi-hop
 * shapes together without any JS timing.
 */

import { useTheme } from "@/components/theme/theme-provider";

import { flowStart } from "./flow-geometry";

export const FLOW_CYCLE = 15;

/**
 * A wide blurred halo reads as light on a dark page and as a smudge on a pale one,
 * so light mode gets a tighter, fainter bloom around a crisper dot.
 */
function useGlow() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return {
    blur: isDark ? 7 : 4,
    haloRadius: isDark ? 11 : 8,
    haloPeak: isDark ? 0.55 : 0.32,
    corePeak: isDark ? 0.95 : 1,
    lineOpacity: isDark ? 0.75 : 0.85,
  };
}

export type FlowLeg = {
  id: string;
  d: string;
  color: string;
  from: number;
  to: number;
  /** Resting stroke width; heavier legs read as carrying more. */
  width?: number;
  /**
   * Stream this leg belongs to. Legs of one stream share a stagger offset, so a dot
   * handing off between them stays on the same beat.
   */
  lane?: number;
};

export function FlowCanvas({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      {children}
    </svg>
  );
}

export function FlowDefs({ legs }: { legs: FlowLeg[] }) {
  const glow = useGlow();

  return (
    <>
      {legs.map((leg) => (
        <path key={leg.id} id={leg.id} d={leg.d} />
      ))}

      <filter id="flow-glow" x="-150%" y="-150%" width="400%" height="400%">
        <feGaussianBlur stdDeviation={glow.blur} />
      </filter>

      <linearGradient id="flow-edge-fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="white" stopOpacity="0" />
        <stop offset="13%" stopColor="white" stopOpacity="1" />
        <stop offset="86%" stopColor="white" stopOpacity="1" />
        <stop offset="100%" stopColor="white" stopOpacity="0" />
      </linearGradient>
      <mask id="flow-edge-mask">
        <rect x="0" y="0" width="1440" height="900" fill="url(#flow-edge-fade)" />
      </mask>
    </>
  );
}

export function FlowLines({ legs }: { legs: FlowLeg[] }) {
  const glow = useGlow();

  return (
    <>
      {legs.map((leg) => (
        <use
          key={`${leg.id}-line`}
          href={`#${leg.id}`}
          stroke="var(--auth-flow-line)"
          strokeWidth={leg.width ?? 1.4}
          opacity={glow.lineOpacity}
        />
      ))}
    </>
  );
}

function FlowDot({
  leg,
  delay,
  glow,
  cycle,
}: {
  leg: FlowLeg;
  delay: number;
  glow?: boolean;
  cycle: number;
}) {
  const begin = `${delay}s`;
  const tuning = useGlow();
  const peak = glow ? tuning.haloPeak : tuning.corePeak;

  return (
    <circle
      r={glow ? tuning.haloRadius : 4}
      fill={leg.color}
      filter={glow ? "url(#flow-glow)" : undefined}
      opacity={0}
    >
      <animateMotion
        dur={`${cycle}s`}
        begin={begin}
        repeatCount="indefinite"
        keyPoints="0;0;1;1"
        keyTimes={`0;${leg.from};${leg.to};1`}
        calcMode="linear"
      >
        <mpath href={`#${leg.id}`} />
      </animateMotion>
      <animate
        attributeName="opacity"
        values={`0;0;${peak};${peak};0;0`}
        keyTimes={`0;${leg.from};${leg.from + 0.02};${leg.to - 0.02};${leg.to};1`}
        dur={`${cycle}s`}
        begin={begin}
        repeatCount="indefinite"
      />
    </circle>
  );
}

export function FlowDots({
  legs,
  cycle = FLOW_CYCLE,
  passes = 2,
  stagger = 0.22,
}: {
  legs: FlowLeg[];
  cycle?: number;
  /** Extra traversals per leg, offset by half a cycle each, for density. */
  passes?: number;
  stagger?: number;
}) {
  return (
    <>
      {legs.map((leg, index) =>
        Array.from({ length: passes }, (_, pass) => {
          const delay = ((leg.lane ?? index) % 5) * stagger + (pass * cycle) / passes;
          return (
            <g key={`${leg.id}-dot-${pass}`}>
              <FlowDot leg={leg} delay={delay} glow cycle={cycle} />
              <FlowDot leg={leg} delay={delay} cycle={cycle} />
            </g>
          );
        }),
      )}
    </>
  );
}

/** Reduced-motion fallback: park a dot at the head of each entry leg. */
export function FlowDotsStatic({ legs }: { legs: FlowLeg[] }) {
  return (
    <>
      {legs.map((leg) => {
        const start = flowStart(leg.d);
        return (
          <circle
            key={`${leg.id}-static`}
            cx={start.x + 120}
            cy={start.y}
            r={4}
            fill={leg.color}
            opacity={0.55}
          />
        );
      })}
    </>
  );
}

/** A ring that flares once per cycle, at `at` (cycle fraction). */
export function FlowPulse({
  x,
  y,
  at,
  from = 4,
  to = 14,
  cycle = FLOW_CYCLE,
  filled = true,
}: {
  x: number;
  y: number;
  at: number;
  from?: number;
  to?: number;
  cycle?: number;
  filled?: boolean;
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r={from}
      fill={filled ? "var(--auth-flow-accent)" : "none"}
      stroke={filled ? undefined : "var(--auth-flow-accent)"}
      strokeWidth={filled ? undefined : 2}
      opacity={0}
    >
      <animate
        attributeName="r"
        values={`${from};${from};${to};${to}`}
        keyTimes={`0;${at};${Math.min(at + 0.09, 0.999)};1`}
        dur={`${cycle}s`}
        repeatCount="indefinite"
      />
      <animate
        attributeName="opacity"
        values="0;0.8;0;0"
        keyTimes={`0;${Math.min(at + 0.005, 0.99)};${Math.min(at + 0.09, 0.999)};1`}
        dur={`${cycle}s`}
        repeatCount="indefinite"
      />
    </circle>
  );
}
