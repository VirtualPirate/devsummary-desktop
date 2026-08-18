import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

import {
  FLOW_CYCLE,
  FlowCanvas,
  FlowDefs,
  FlowDots,
  FlowDotsStatic,
  FlowLines,
  type FlowLeg,
} from "./flow";

/**
 * "Mark" — the DevSummary logo at page scale: three commit sources, two curved rails
 * and one straight, the lens ring, then the brief pill. The card sits inside the
 * mark, between the lens and the pill.
 */

const LENS_X = 462;
const LENS_Y = 450;
const LENS_R = 26;
/** Where a rail meets the ring, at 45°. */
const LENS_TOUCH = Math.round(LENS_R * 0.72);
const PILL_X = 1002;
const PILL_W = 384;
const PILL_H = 64;

const SOURCE_X = 92;
const SOURCE_Y = [104, LENS_Y, 796];

/** The logo's own gesture: outer rails bow in, the middle one runs straight. */
const LEGS: FlowLeg[] = [
  {
    id: "bm-rail-top",
    d: `M${SOURCE_X} ${SOURCE_Y[0]} Q310 148 ${LENS_X - LENS_TOUCH} ${LENS_Y - LENS_TOUCH}`,
    color: "var(--auth-flow-feature)",
    from: 0,
    to: 0.4,
    width: 3,
    lane: 0,
  },
  {
    id: "bm-rail-mid",
    d: `M${SOURCE_X} ${LENS_Y} L${LENS_X - LENS_R} ${LENS_Y}`,
    color: "var(--auth-flow-fix)",
    from: 0.04,
    to: 0.42,
    width: 3,
    lane: 1,
  },
  {
    id: "bm-rail-bottom",
    d: `M${SOURCE_X} ${SOURCE_Y[2]} Q310 752 ${LENS_X - LENS_TOUCH} ${LENS_Y + LENS_TOUCH}`,
    color: "var(--auth-flow-optimization)",
    from: 0.02,
    to: 0.41,
    width: 3,
    lane: 2,
  },
  {
    id: "bm-connector",
    d: `M${LENS_X + LENS_R} ${LENS_Y} L${PILL_X} ${LENS_Y}`,
    color: "var(--auth-flow-accent)",
    from: 0.5,
    to: 0.74,
    width: 6,
    lane: 3,
  },
];

const RAILS = LEGS.slice(0, 3);
const CONNECTOR = LEGS[3];

const PASSES = 2;
const STAGGER = 0.42;

/** One entry per dot arrival on a leg, so every hit gets its own flash. */
function hitsFor(leg: FlowLeg) {
  return Array.from({ length: PASSES }, (_, pass) => ({
    key: `${leg.id}-${pass}`,
    at: leg.to,
    begin: (leg.lane ?? 0) * STAGGER + (pass * FLOW_CYCLE) / PASSES,
  }));
}

const LENS_HITS = RAILS.flatMap(hitsFor);
const PILL_HITS = hitsFor(CONNECTOR);

export function BraidMarkBackdrop() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <FlowCanvas>
      <defs>
        <FlowDefs legs={LEGS} />

        <radialGradient id="bm-lens-glow">
          <stop offset="0%" stopColor="var(--auth-flow-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--auth-flow-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g mask="url(#flow-edge-mask)">
        <FlowLines legs={LEGS} />

        {/* The mark's three source dots. */}
        {SOURCE_Y.map((y) => (
          <circle
            key={`bm-source-${y}`}
            cx={SOURCE_X}
            cy={y}
            r={13}
            fill="var(--foreground)"
            opacity={0.32}
          />
        ))}

        <circle cx={LENS_X} cy={LENS_Y} r={150} fill="url(#bm-lens-glow)" />
        <circle
          cx={LENS_X}
          cy={LENS_Y}
          r={LENS_R}
          stroke="var(--auth-flow-accent)"
          strokeWidth={7}
          opacity={0.45}
        />

        {/* Every arriving rail lights the lens: core bloom, brightened ring, halo. */}
        {prefersReducedMotion
          ? null
          : LENS_HITS.map((hit) => {
              const window = (offset: number) => Math.min(hit.at + offset, 0.999);
              const begin = `${hit.begin}s`;

              return (
                <g key={`bm-hit-${hit.key}`}>
                  <circle
                    cx={LENS_X}
                    cy={LENS_Y}
                    r={LENS_R * 0.9}
                    fill="var(--auth-flow-accent)"
                    filter="url(#flow-glow)"
                    opacity={0}
                  >
                    <animate
                      attributeName="opacity"
                      values="0;0;0.85;0;0"
                      keyTimes={`0;${hit.at};${window(0.012)};${window(0.1)};1`}
                      dur={`${FLOW_CYCLE}s`}
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle
                    cx={LENS_X}
                    cy={LENS_Y}
                    r={LENS_R}
                    stroke="var(--auth-flow-accent)"
                    strokeWidth={7}
                    opacity={0}
                  >
                    <animate
                      attributeName="opacity"
                      values="0;0;0.9;0;0"
                      keyTimes={`0;${hit.at};${window(0.01)};${window(0.09)};1`}
                      dur={`${FLOW_CYCLE}s`}
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle
                    cx={LENS_X}
                    cy={LENS_Y}
                    r={LENS_R}
                    stroke="var(--auth-flow-accent)"
                    strokeWidth={2}
                    opacity={0}
                  >
                    <animate
                      attributeName="r"
                      values={`${LENS_R};${LENS_R};${LENS_R * 2.6};${LENS_R * 2.6}`}
                      keyTimes={`0;${hit.at};${window(0.11)};1`}
                      dur={`${FLOW_CYCLE}s`}
                      begin={begin}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.7;0;0"
                      keyTimes={`0;${window(0.008)};${window(0.11)};1`}
                      dur={`${FLOW_CYCLE}s`}
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              );
            })}

        {prefersReducedMotion ? (
          <FlowDotsStatic legs={RAILS} />
        ) : (
          <FlowDots legs={LEGS} passes={PASSES} stagger={STAGGER} />
        )}

        {/* The brief: an outline that lights when the run reaches it. */}
        <rect
          x={PILL_X}
          y={LENS_Y - PILL_H / 2}
          width={PILL_W}
          height={PILL_H}
          rx={PILL_H / 2}
          fill="none"
          stroke="var(--auth-flow-accent)"
          strokeWidth={6}
          opacity={0.34}
        />

        {prefersReducedMotion
          ? null
          : PILL_HITS.map((hit) => {
              const window = (offset: number) => Math.min(hit.at + offset, 0.999);
              const begin = `${hit.begin}s`;
              const geometry = {
                x: PILL_X,
                y: LENS_Y - PILL_H / 2,
                width: PILL_W,
                height: PILL_H,
                rx: PILL_H / 2,
                fill: "none",
                stroke: "var(--auth-flow-accent)",
              };

              return (
                <g key={`bm-pill-hit-${hit.key}`}>
                  <rect
                    {...geometry}
                    strokeWidth={10}
                    filter="url(#flow-glow)"
                    opacity={0}
                  >
                    <animate
                      attributeName="opacity"
                      values="0;0;0.8;0;0"
                      keyTimes={`0;${hit.at};${window(0.016)};${window(0.14)};1`}
                      dur={`${FLOW_CYCLE}s`}
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </rect>
                  <rect {...geometry} strokeWidth={6} opacity={0}>
                    <animate
                      attributeName="opacity"
                      values="0;0;0.95;0.4;0;0"
                      keyTimes={`0;${hit.at};${window(0.012)};${window(0.08)};${window(0.16)};1`}
                      dur={`${FLOW_CYCLE}s`}
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </rect>
                </g>
              );
            })}
      </g>
    </FlowCanvas>
  );
}
