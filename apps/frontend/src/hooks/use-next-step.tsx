import type { NextStep } from "@/components/devsummary/onboarding/next-step-bar";
import { useGetBriefSchedules } from "@/hooks/api/use-brief-schedules";
import {
  useGithubInstallations,
  useRepositoryIngestStatus,
} from "@/hooks/api/use-github-integrations";
import { useJobActivity } from "@/hooks/api/use-jobs";
import { useCurrentOrganization } from "@/hooks/api/use-organizations";

/**
 * What the next-step bar should say on `/`, or `null` when there is nothing to
 * say. Rendered inline above Activity — deliberately not a takeover: the charts
 * are what the user came for, and hiding them to explain a missing schedule
 * trades away the one thing that shows the product working.
 *
 * The ladder above this one still belongs to `useConnectReposGate`, which does
 * take the page over: with nothing connected, or no branch chosen anywhere,
 * there is genuinely no dashboard to show.
 */
export function useNextStep(): NextStep | null {
  const installationsQuery = useGithubInstallations();
  const schedulesQuery = useGetBriefSchedules();
  const currentOrg = useCurrentOrganization();
  const jobs = useJobActivity();

  const repos = (installationsQuery.data?.data ?? []).flatMap(
    (i) => i.repositories,
  );
  const hasTrackedRepo = repos.some((r) => r.branch !== null);
  const schedules = schedulesQuery.data?.data ?? [];

  // Same freshness rule as the setup page: `!== "viewer"` is briefly true while
  // the org refetches after a switch, which would flash an admin action.
  const role = currentOrg.data?.data.role;
  const canSchedule = role === "owner" || role === "admin";

  const ingestQuery = useRepositoryIngestStatus({
    enabled: hasTrackedRepo && schedules.length === 0 && canSchedule,
  });

  if (!hasTrackedRepo || !schedulesQuery.isSuccess) return null;

  if (schedules.length > 0) {
    // Only while the *first* briefs are being written: once anything has been
    // delivered this is a normal recurring run and needs no narration.
    const neverSent = schedules.every((s) => s.lastSentAt === null);
    const generating = (jobs.data?.data.generating ?? 0) > 0;
    if (neverSent && generating) {
      return { kind: "writing", scheduleName: schedules[0].name };
    }
    return null;
  }

  if (!canSchedule) {
    return {
      kind: "viewer",
      orgName: currentOrg.data?.data.organization.name,
    };
  }

  const status = ingestQuery.data?.data;
  if (!status || status.repositories.length === 0) return null;

  const totals = status.repositories.reduce(
    (acc, r) => ({
      processed: acc.processed + r.processedCount,
      commits: acc.commits + r.commitCount,
      skipped: acc.skipped + r.skippedCount,
      fetching:
        acc.fetching + (r.fetching.state === "done" ? 0 : 1),
    }),
    { processed: 0, commits: 0, skipped: 0, fetching: 0 },
  );

  if (!status.ingesting) {
    return {
      kind: "schedule",
      processed: totals.processed,
      commits: totals.commits,
      skipped: totals.skipped,
    };
  }

  // Oldest running phase across every repository: that is the elapsed time the
  // user is actually waiting on, and the one the stall threshold applies to.
  // Whether it *has* stalled is decided in the bar, which already ticks a clock
  // — reading the wall clock here would make this hook impure.
  const started = status.repositories.flatMap((r) =>
    [r.fetching.startedAt, r.analyzing.startedAt]
      .filter((iso): iso is string => iso !== null)
      .map((iso) => ({ repo: r.fullName, at: new Date(iso).getTime() })),
  );
  const oldest = started.reduce<(typeof started)[number] | null>(
    (min, cur) => (min === null || cur.at < min.at ? cur : min),
    null,
  );

  return {
    kind: "ingesting",
    fetchingRepos: totals.fetching,
    totalRepos: status.repositories.length,
    processed: totals.processed,
    commits: totals.commits,
    anyFetching: totals.fetching > 0,
    startedAt: oldest ? new Date(oldest.at).toISOString() : null,
    oldestRepo: oldest?.repo ?? null,
  };
}
