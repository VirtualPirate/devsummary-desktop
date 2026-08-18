/**
 * GitHub inlines at most this many commits in a `push` payload; past it the
 * array is truncated and the delivery no longer names every pushed commit.
 * Older payloads (and the Events API) also carry `size`, which is preferred
 * when present because it states the real count outright.
 */
const PUSH_COMMITS_INLINE_CAP = 2048;

export interface ParsedPush {
  /** Branch name, `refs/heads/` stripped. */
  branch: string;
  /** Every sha the delivery named, head commit included, de-duplicated. */
  shas: string[];
  headSha: string;
  /** True when the payload does not name every pushed commit. */
  truncated: boolean;
  /** Earliest commit timestamp in the payload, or null when none carried one. */
  earliestPushedISO: string | null;
}

/**
 * Reads a `push` delivery into the facts ingestion needs, or `null` when the
 * delivery cannot produce any: a tag push (`refs/tags/…`), a branch deletion, or
 * a payload naming no commit at all (a branch created at an existing tip).
 *
 * Deliberately tolerant — a webhook body is untrusted input, and every unknown
 * shape has to fall through to "nothing to ingest" rather than throw, because the
 * caller has already answered GitHub 200 and nothing re-processes the row.
 */
export function parsePushEvent(
  raw: Record<string, unknown>,
): ParsedPush | null {
  const ref = typeof raw.ref === 'string' ? raw.ref : null;
  if (!ref?.startsWith('refs/heads/')) return null;
  if (raw.deleted === true) return null;

  const branch = ref.slice('refs/heads/'.length);
  if (branch.length === 0) return null;

  const commits: unknown[] = Array.isArray(raw.commits)
    ? (raw.commits as unknown[])
    : [];
  const head = isRecord(raw.head_commit) ? raw.head_commit : null;

  const shas: string[] = [];
  let earliest: number | null = null;
  for (const entry of [...commits, ...(head ? [head] : [])]) {
    if (!isRecord(entry)) continue;
    const sha = typeof entry.id === 'string' ? entry.id : null;
    if (sha && !shas.includes(sha)) shas.push(sha);
    const at =
      typeof entry.timestamp === 'string'
        ? new Date(entry.timestamp).getTime()
        : NaN;
    if (!Number.isNaN(at) && (earliest === null || at < earliest))
      earliest = at;
  }

  const headSha =
    (typeof head?.id === 'string' ? head.id : null) ??
    (typeof raw.after === 'string' ? raw.after : null) ??
    shas[shas.length - 1] ??
    null;
  if (!headSha) return null;
  if (shas.length === 0) return null;

  const size = typeof raw.size === 'number' ? raw.size : null;
  const truncated =
    size !== null
      ? size > commits.length
      : commits.length >= PUSH_COMMITS_INLINE_CAP;

  return {
    branch,
    shas,
    headSha,
    truncated,
    earliestPushedISO:
      earliest === null ? null : new Date(earliest).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
