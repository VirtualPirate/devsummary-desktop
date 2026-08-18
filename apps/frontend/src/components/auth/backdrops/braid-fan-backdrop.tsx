import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

import {
  FlowCanvas,
  FlowDefs,
  FlowDots,
  FlowDotsStatic,
  FlowLines,
  type FlowLeg,
} from "./flow";
import { hSeg } from "./flow-geometry";

/**
 * "Fan" — an hourglass. Ten streams compress into a tight parallel bundle at the
 * card, then open out the far side as evenly spaced lines of the brief.
 */

const THROAT_X = 466;
const EXIT_X = 974;
const CENTER_Y = 450;

const IN_COUNT = 10;
const OUT_COUNT = 8;
/** Bundle spacing where the streams are tightest. */
const BUNDLE_GAP = 11;
const OUT_GAP = 13;

const TYPES = [
  "feature",
  "fix",
  "refactor",
  "optimization",
  "docs",
  "test",
  "chore",
];

const IN_LEGS: FlowLeg[] = Array.from({ length: IN_COUNT }, (_, index) => {
  const spread = (index - (IN_COUNT - 1) / 2) / ((IN_COUNT - 1) / 2);
  return {
    id: `bf-in-${index}`,
    d: hSeg(
      -70,
      CENTER_Y + spread * 470,
      THROAT_X,
      CENTER_Y + spread * ((IN_COUNT - 1) / 2) * BUNDLE_GAP,
      0.6,
    ),
    color: `var(--auth-flow-${TYPES[index % TYPES.length]})`,
    from: 0,
    to: 0.4,
    lane: index,
  };
});

const OUT_LEGS: FlowLeg[] = Array.from({ length: OUT_COUNT }, (_, index) => {
  const spread = (index - (OUT_COUNT - 1) / 2) / ((OUT_COUNT - 1) / 2);
  return {
    id: `bf-out-${index}`,
    d: hSeg(
      EXIT_X,
      CENTER_Y + spread * ((OUT_COUNT - 1) / 2) * OUT_GAP,
      1520,
      CENTER_Y + spread * 420,
      0.6,
    ),
    color: "var(--auth-flow-accent)",
    from: 0.54,
    to: 0.94,
    width: 1.6,
    lane: index,
  };
});

const LEGS = [...IN_LEGS, ...OUT_LEGS];

export function BraidFanBackdrop() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <FlowCanvas>
      <defs>
        <FlowDefs legs={LEGS} />

        <radialGradient id="bf-throat-glow">
          <stop offset="0%" stopColor="var(--auth-flow-accent)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--auth-flow-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g mask="url(#flow-edge-mask)">
        <FlowLines legs={LEGS} />

        <circle cx={THROAT_X} cy={CENTER_Y} r={150} fill="url(#bf-throat-glow)" />

        {prefersReducedMotion ? (
          <FlowDotsStatic legs={IN_LEGS} />
        ) : (
          <FlowDots legs={LEGS} passes={3} stagger={0.62} />
        )}
      </g>
    </FlowCanvas>
  );
}
