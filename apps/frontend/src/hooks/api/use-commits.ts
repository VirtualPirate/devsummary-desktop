import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { ListCommitsQuery } from "@launchstack/api-interfaces";
import { CommitsAPI } from "@/api/commits.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export type CommitListFilters = Omit<
  Partial<ListCommitsQuery>,
  "cursor" | "limit"
> & { limit?: number };

export const commitsKeys = {
  list: (orgId: string | null, filters: CommitListFilters) =>
    ["commits", "list", orgId, filters] as const,
};

export function useGetCommits(filters: CommitListFilters = {}) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  const limit = filters.limit ?? 50;
  return useInfiniteQuery({
    queryKey: commitsKeys.list(orgId, filters),
    enabled: !!orgId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      CommitsAPI.list({ ...filters, limit, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
    // Changing a filter keeps the previous page on screen rather than
    // flashing the skeleton between two nearly identical lists.
    placeholderData: keepPreviousData,
  });
}
