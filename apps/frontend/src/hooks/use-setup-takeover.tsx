import type { ReactNode } from "react";
import { AwaitingSchedule } from "@/components/devsummary/onboarding/awaiting-schedule";
import { SetupConsole } from "@/components/devsummary/onboarding/setup-console";
import { useGetBriefSchedules } from "@/hooks/api/use-brief-schedules";
import {
  useGithubInstallations,
  useRepositoryIngestStatus,
} from "@/hooks/api/use-github-integrations";
import { useCurrentOrganization } from "@/hooks/api/use-organizations";

/**
 * The setup console for `/briefs`, or null when the page should show its own
 * empty state instead.
 *
 * Only for a list that is empty *because nothing is scheduled*. The caller passes
 * `enabled` for "the list really is empty and unfiltered" — a one-off generated
 * brief means the list has content even with no schedule, and the console must
 * not replace it.
 *
 * Unlike `useNextStep` (home), this does own the page: `/briefs` has nothing to
 * hide, which is the only reason the takeover was the wrong shape for home.
 *
 * Returns null whenever the state can't be established. A failed status read must
 * leave the page's own empty state visible rather than blank it.
 */
export function useSetupTakeover({
  enabled,
  onGenerate,
}: {
  enabled: boolean;
  onGenerate: () => void;
}): ReactNode | null {
  const installationsQuery = useGithubInstallations();
  const schedulesQuery = useGetBriefSchedules();
  const currentOrg = useCurrentOrganization();

  const repos = (installationsQuery.data?.data ?? []).flatMap(
    (i) => i.repositories,
  );
  const hasTrackedRepo = repos.some((r) => r.branch !== null);
  const hasSchedule = (schedulesQuery.data?.data ?? []).length > 0;

  // Same freshness rule as the setup page: `!== "viewer"` is briefly true while
  // the org refetches after a switch, which would flash an admin action.
  const role = currentOrg.data?.data.role;
  const canSchedule = role === "owner" || role === "admin";

  const wanted =
    enabled &&
    hasTrackedRepo &&
    !hasSchedule &&
    schedulesQuery.isSuccess &&
    installationsQuery.isSuccess;

  const ingestQuery = useRepositoryIngestStatus({
    enabled: wanted && canSchedule,
  });

  if (!wanted) return null;

  if (!canSchedule) {
    return (
      <AwaitingSchedule orgName={currentOrg.data?.data.organization.name} />
    );
  }

  const status = ingestQuery.data?.data;
  if (!status || status.repositories.length === 0) return null;

  return <SetupConsole status={status} onGenerate={onGenerate} />;
}
