import { useQuery } from "@tanstack/react-query";
import { JobsAPI } from "@/api/jobs.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const jobsKeys = {
  activity: (orgId: string | null) => ["jobs", "activity", orgId] as const,
};

// Poll fast while work is in flight so the toast feels live; back off when idle
// to keep the ambient cost low. Hidden tabs don't poll.
const ACTIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 15000;

export function useJobActivity() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: jobsKeys.activity(orgId),
    queryFn: () => JobsAPI.activity(),
    enabled: !!orgId,
    refetchInterval: (query) =>
      query.state.data?.data?.active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
