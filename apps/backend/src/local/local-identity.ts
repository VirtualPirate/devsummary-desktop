/**
 * Fixed identity for the single local desktop user.
 *
 * Seeded idempotently by migration 00016_seed_local_singleton. Every request runs as this
 * user; the org id is only the *fallback* workspace — the active workspace still arrives
 * via the X-Organization-Id header (see docs/DELTAS.md D-A).
 */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_ORG_ID = '00000000-0000-4000-8000-000000000002';
export const LOCAL_USER_EMAIL = 'local@devsummary.app';
export const LOCAL_USER_NAME = 'Local User';
export const LOCAL_ORG_NAME = 'My Workspace';
