import { useQuery } from "@tanstack/react-query";
import type {
  GetCommitActivityQuery,
  GetCommitHoursQuery,
} from "@launchstack/api-interfaces";
import { AnalyticsAPI } from "@/api/analytics.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const analyticsKeys = {
  commitActivity: (orgId: string | null, params: GetCommitActivityQuery) =>
    ["analytics", "commit-activity", orgId, params] as const,
  commitHours: (orgId: string | null, params: GetCommitHoursQuery) =>
    ["analytics", "commit-hours", orgId, params] as const,
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

export function useGetCommitHours(params: GetCommitHoursQuery) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: analyticsKeys.commitHours(orgId, params),
    queryFn: () => AnalyticsAPI.getCommitHours(params),
    enabled: !!orgId,
    staleTime: 60_000,
  });
}
