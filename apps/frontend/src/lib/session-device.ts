/**
 * Turning a Better Auth session row into something a person recognises.
 *
 * `GET /list-sessions` hands back the raw `user_agent` string and nothing else
 * about the device, so the label is derived here. This is deliberately a
 * handful of regexes rather than a dependency: it covers the browsers and
 * platforms this app is actually used from and degrades to the raw string when
 * it doesn't recognise something, which is honest and costs nothing.
 *
 * ponytail: swap in `ua-parser-js` if the fallback starts showing up in real
 * sessions — the call sites only consume the returned label.
 */

const BROWSERS: Array<[RegExp, string]> = [
  // Order matters: Edge and Opera also claim "Chrome", Chrome also claims
  // "Safari". Most specific first.
  [/\bEdgA?\/|\bEdge\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: Array<[RegExp, string]> = [
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

function match(patterns: Array<[RegExp, string]>, ua: string): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(ua)) return label;
  }
  return null;
}

/** e.g. "Chrome on macOS". Falls back to the raw UA, truncated. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim();
  if (!ua) return "Unknown device";

  const browser = match(BROWSERS, ua);
  const platform = match(PLATFORMS, ua);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;

  return ua.length > 48 ? `${ua.slice(0, 48)}…` : ua;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

/**
 * "active now" / "3 hours ago". Anything under a minute reads as active now —
 * the session row is touched on refresh, so sub-minute precision is noise.
 */
export function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Unknown";

  const elapsed = Date.now() - then;
  if (elapsed < 60_000) return "active now";

  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) {
      return RELATIVE.format(-Math.floor(elapsed / ms), unit);
    }
  }
  return "active now";
}
