/** Path helpers for the flow backdrops. Kept apart from the components for fast refresh. */

/** Horizontal S-curve from (x0,y0) to (x1,y1) — the house style for every leg. */
export function hSeg(x0: number, y0: number, x1: number, y1: number, ease = 0.55) {
  const span = x1 - x0;
  return `M${x0} ${y0} C${x0 + span * ease} ${y0} ${x1 - span * ease} ${y1} ${x1} ${y1}`;
}

export function flowStart(d: string) {
  const [, x, y] = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(d) ?? ["", "0", "0"];
  return { x: Number(x), y: Number(y) };
}
