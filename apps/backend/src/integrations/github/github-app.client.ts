/**
 * Compatibility re-export. The implementation moved to `./github.client` when
 * the GitHub App was replaced by a pasted PAT; the two activity files under
 * `commit-analysis/activities/` still import from this path and are owned by
 * the activity-port phase. Delete this file once they point at `./github.client`.
 */
export * from './github.client';
