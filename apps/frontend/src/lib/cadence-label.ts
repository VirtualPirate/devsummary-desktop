import type {
  BriefScheduleResponse,
  CadenceInput,
} from "@launchstack/api-interfaces";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function dayName(dayOfWeek: number, long = true): string {
  return (long ? DAYS_LONG : DAYS_SHORT)[dayOfWeek] ?? "?";
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "14:30" (or "14:30:00" off the wire) → "2:30 PM". */
export function friendlyTime(raw: string): string {
  const [h, m] = raw.slice(0, 5).split(":");
  const hour = Number(h);
  const minute = m ?? "00";
  if (Number.isNaN(hour)) return raw;
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

export function shortZone(tz: string): string {
  return tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
}

/** Jargon-free cadence, no timezone: "Every Monday at 9:00 AM". */
export function cadencePhrase(cadence: CadenceInput): string {
  const time = friendlyTime(cadence.time);
  if (cadence.type === "daily") return `Every day at ${time}`;
  if (cadence.type === "weekly")
    return `Every ${dayName(cadence.dayOfWeek)} at ${time}`;
  return `Monthly on the ${ordinal(cadence.dayOfMonth)} at ${time}`;
}

/** Same, as a full sentence with the zone — for previews under the fields. */
export function cadenceSentence(
  cadence: CadenceInput,
  timezone: string,
): string {
  const phrase = cadencePhrase(cadence);
  return `Sends ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}, ${shortZone(timezone)} time.`;
}

export function cadenceLabel(schedule: BriefScheduleResponse): string {
  const time = schedule.cadence.time.slice(0, 5);
  const tz = schedule.timezone;
  if (schedule.cadence.type === "daily") return `Daily at ${time} ${tz}`;
  if (schedule.cadence.type === "weekly") {
    return `Weekly · ${dayName(schedule.cadence.dayOfWeek, false)} at ${time} ${tz}`;
  }
  return `Monthly · day ${schedule.cadence.dayOfMonth} at ${time} ${tz}`;
}

/**
 * `timeZone` is optional but is **not** optional for a schedule's own clock.
 * `nextRunAt` and `lastSentAt` are instants derived from a cadence expressed in
 * the schedule's zone, and they are rendered inches from `cadencePhrase` ("Every
 * day at 9:00 AM") and the zone name — so formatting them in the viewer's zone
 * put three fields on one row answering in two different clocks. Pass
 * `schedule.timezone`. Omit it only for a timestamp that is a real-world event
 * in its own right, like "this brief was generated 2 hours ago".
 */
export function formatTimestamp(
  iso: string | null,
  timeZone?: string,
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/** Weekday + date + time, for "first brief lands …". */
export function formatRunAt(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
