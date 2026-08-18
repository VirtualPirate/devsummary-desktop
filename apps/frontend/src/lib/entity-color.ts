export function colorFromString(s: string, saturation = 65, lightness = 55): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}deg ${saturation}% ${lightness}%)`;
}

export const NEUTRAL_DOT_COLOR = "var(--muted-foreground)";
