import { useQuery } from "@tanstack/react-query";
import type { GetCommitActivityQuery } from "@launchstack/api-interfaces";
import { AnalyticsAPI } from "@/api/analytics.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const analyticsKeys = {
  commitActivity: (orgId: string | null, params: GetCommitActivityQuery) =>
    ["analytics", "commit-activity", orgId, params] as const,
};

export function useGetCommitActivity(params: GetCommitActivityQuery) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: analyticsKeys.commitActivity(orgId, params),
    queryFn: () => AnalyticsAPI.getCommitActivity(params),
    enabled: !!orgId,
    staleTime: 60_000,
  });
}
