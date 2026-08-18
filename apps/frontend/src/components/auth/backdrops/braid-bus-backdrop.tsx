import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

import {
  FlowCanvas,
  FlowDefs,
  FlowDots,
  FlowDotsStatic,
  FlowLines,
  FlowPulse,
  type FlowLeg,
} from "./flow";

/**
 * "Bus" — routed like a board. Each repository taps onto a single bus line, the bus
 * runs through the card, and the brief fans out to three delivery endpoints.
 */

const BUS_Y = 450;
const THROAT_X = 462;
const EXIT_X = 978;
const CORNER = 18;

/** Right-angled run with rounded corners: out, across, out again. */
function orth(x0: number, y0: number, xTurn: number, y1: number, x1: number) {
  if (y0 === y1) return `M${x0} ${y0} H${x1}`;

  const sign = y1 > y0 ? 1 : -1;
  return [
    `M${x0} ${y0}`,
    `H${xTurn - CORNER}`,
    `Q${xTurn} ${y0} ${xTurn} ${y0 + sign * CORNER}`,
    `V${y1 - sign * CORNER}`,
    `Q${xTurn} ${y1} ${xTurn + CORNER} ${y1}`,
    `H${x1}`,
  ].join(" ");
}

const TAPS = [
  { y: 96, turn: 132, type: "feature" },
  { y: 216, turn: 196, type: "fix" },
  { y: 330, turn: 260, type: "docs" },
  { y: 570, turn: 260, type: "refactor" },
  { y: 690, turn: 196, type: "test" },
  { y: 810, turn: 132, type: "optimization" },
];

const OUTPUTS = [
  { y: 318, turn: 1148 },
  { y: BUS_Y, turn: 1148 },
  { y: 582, turn: 1148 },
];

const LEGS: FlowLeg[] = [
  ...TAPS.map((tap, index) => ({
    id: `bb-in-${index}`,
    d: orth(-70, tap.y, tap.turn, BUS_Y, THROAT_X),
    color: `var(--auth-flow-${tap.type})`,
    from: 0,
    to: 0.46,
    lane: index,
  })),
  ...OUTPUTS.map((output, index) => ({
    id: `bb-out-${index}`,
    d: orth(EXIT_X, BUS_Y, output.turn, output.y, 1300),
    color: "var(--auth-flow-accent)",
    from: 0.58,
    to: 0.9,
    width: 1.8,
    lane: index,
  })),
];

export function BraidBusBackdrop() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <FlowCanvas>
      <defs>
        <FlowDefs legs={LEGS} />
      </defs>

      <g mask="url(#flow-edge-mask)">
        <FlowLines legs={LEGS} />

        {/* The bus itself, heavier than its taps. */}
        <line
          x1={100}
          y1={BUS_Y}
          x2={THROAT_X}
          y2={BUS_Y}
          stroke="var(--auth-flow-line)"
          strokeWidth={2.4}
          opacity={0.85}
        />

        {TAPS.map((tap) => (
          <g key={`bb-tap-${tap.y}`}>
            <circle cx={tap.turn} cy={BUS_Y} r={3.5} fill="var(--auth-flow-line)" opacity={0.9} />
            {prefersReducedMotion ? null : (
              <FlowPulse x={tap.turn} y={BUS_Y} at={0.3} from={3.5} to={12} />
            )}
          </g>
        ))}

        {prefersReducedMotion ? (
          <FlowDotsStatic legs={LEGS.slice(0, TAPS.length)} />
        ) : (
          <FlowDots legs={LEGS} stagger={0.18} />
        )}

        <circle
          cx={THROAT_X}
          cy={BUS_Y}
          r={16}
          stroke="var(--auth-flow-accent)"
          strokeWidth={3}
          opacity={0.5}
        />

        {OUTPUTS.map((output) => (
          <g key={`bb-out-node-${output.y}`}>
            <rect
              x={1300}
              y={output.y - 11}
              width={92}
              height={22}
              rx={11}
              fill="var(--auth-flow-accent)"
              opacity={0.26}
            />
            {prefersReducedMotion ? null : (
              <FlowPulse x={1300} y={output.y} at={0.9} from={6} to={22} filled={false} />
            )}
          </g>
        ))}
      </g>
    </FlowCanvas>
  );
}
