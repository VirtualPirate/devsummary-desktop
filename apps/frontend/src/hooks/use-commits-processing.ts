import { useRepositoryIngestStatus } from "@/hooks/api/use-github-integrations";

/**
 * Why generating (or regenerating) a brief is refused mid-ingest. Lives here
 * rather than beside any one button because the dialog, the briefs page and the
 * brief viewer's retry all show it.
 */
export const GENERATE_BLOCKED_REASON =
  "Commits are still being fetched and analyzed. A brief written now would only cover part of the history, and briefs are never rewritten.";

/**
 * True while any repository is still fetching or analyzing commits.
 *
 * Schedule creation is blocked meanwhile — creating one immediately backfills
 * briefs off the commits stored at that instant, and nothing ever regenerates a
 * brief, so a schedule made mid-ingest permanently writes history over a
 * partially read repository.
 *
 * Reads the same `ingesting` flag `BriefSchedulesService.create` gates on
 * server-side (`GET .../repositories/ingest-status`), so a disabled button and a
 * rejected POST never disagree. `=== true` on purpose: while the query is
 * loading or after it fails nothing is disabled — the server still has the final
 * say, and a button stuck disabled on a failed read is the worse direction.
 */
export function useCommitsProcessing(): boolean {
  const query = useRepositoryIngestStatus();
  return query.data?.data.ingesting === true;
}
