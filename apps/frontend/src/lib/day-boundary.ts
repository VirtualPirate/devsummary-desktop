/**
 * `<Input type="date">` yields a calendar date in the *viewer's* zone, so the
 * instant has to be built from local fields. String-concatenating a `Z` (or
 * `new Date("YYYY-MM-DD")`, which also parses as UTC) makes "from Aug 14" mean
 * Aug 14 10:00 local for a user at UTC+10, dropping briefs that ended that day.
 *
 * Both bounds are **exclusive local midnights**, because the server compares
 * them against a brief's exclusive `periodEnd` (`periodEnd > from`,
 * `periodEnd <= to`). A brief covering Aug 14 ends at Aug 15 00:00, so "to
 * Aug 14" has to send Aug 15 00:00 to include it, and "from Aug 14" has to send
 * Aug 14 00:00 to exclude the brief covering Aug 13 — which ends at exactly
 * that instant.
 */
export function localDayBoundary(date: string, end: boolean): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d + (end ? 1 : 0)).toISOString();
}
