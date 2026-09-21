import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BriefCommitsQuery,
  BriefPreviewQuery,
  BriefStatus,
  GenerateBriefRequest,
  ListBriefsQuery,
} from "@launchstack/api-interfaces";
import { BriefsAPI } from "@/api/briefs.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

const POLL_STATUSES: ReadonlyArray<BriefStatus> = [
  "pending",
  "generating",
  "generated",
];

export type BriefListFilters = Omit<ListBriefsQuery, "cursor" | "limit"> & {
  limit?: number;
};

export type BriefCommitFilters = Pick<
  Partial<BriefCommitsQuery>,
  "contributor" | "commitType"
>;

export const briefsKeys = {
  list: (orgId: string | null, filters: BriefListFilters) =>
    ["briefs", "list", orgId, filters] as const,
  detail: (orgId: string | null, briefId: string) =>
    ["briefs", "detail", orgId, briefId] as const,
  commits: (
    orgId: string | null,
    briefId: string,
    filters: BriefCommitFilters = {},
  ) => ["briefs", "commits", orgId, briefId, filters] as const,
  report: (orgId: string | null, briefId: string) =>
    ["briefs", "report", orgId, briefId] as const,
  preview: (orgId: string | null, query: BriefPreviewQuery | null) =>
    ["briefs", "preview", orgId, query] as const,
};

/**
 * What a scope + period holds, before generating it. `null` disables the query
 * — the dialog has no scope picked yet, or is closed.
 *
 * `keepPreviousData` matters here: without it the rail empties on every scope
 * click, which reads as "zero commits" for a beat before the real count lands.
 */
export function useBriefPreview(query: BriefPreviewQuery | null) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: briefsKeys.preview(orgId, query),
    queryFn: () => BriefsAPI.preview(query as BriefPreviewQuery),
    enabled: !!orgId && !!query,
    placeholderData: keepPreviousData,
    // The counts move only when commits are ingested, and the dialog is short-lived.
    staleTime: 30_000,
    retry: false,
  });
}

export function useGetBriefs(filters: BriefListFilters = {}) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  const limit = filters.limit ?? 20;
  return useInfiniteQuery({
    queryKey: briefsKeys.list(orgId, filters),
    enabled: !!orgId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      BriefsAPI.list({ ...filters, limit, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
  });
}

export function useGetBriefsFirstPage(filters: BriefListFilters = {}) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  const limit = filters.limit ?? 5;
  return useQuery({
    queryKey: briefsKeys.list(orgId, { ...filters, limit }),
    queryFn: () => BriefsAPI.list({ ...filters, limit }),
    enabled: !!orgId,
  });
}

export function useGetBrief(briefId: string | undefined) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: briefsKeys.detail(orgId, briefId ?? ""),
    queryFn: () => BriefsAPI.get(briefId as string),
    enabled: !!orgId && !!briefId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      if (!status) return false;
      return POLL_STATUSES.includes(status) ? 2000 : false;
    },
  });
}

/**
 * The report aggregates live GitHub data rather than the brief's frozen commit
 * set, so it is populated while the brief is still generating — which is what
 * lets the facts rail render beside a skeleton story. It polls on the same
 * cadence as the brief itself so the two never disagree on screen.
 */
export function useGetBriefReport(
  briefId: string | undefined,
  { isWorking = false }: { isWorking?: boolean } = {},
) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: briefsKeys.report(orgId, briefId ?? ""),
    queryFn: () => BriefsAPI.getReport(briefId as string),
    enabled: !!orgId && !!briefId,
    refetchInterval: isWorking ? 2000 : false,
  });
}

export function useGetBriefCommits(
  briefId: string | undefined,
  { limit = 50, ...filters }: BriefCommitFilters & { limit?: number } = {},
) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useInfiniteQuery({
    queryKey: briefsKeys.commits(orgId, briefId ?? "", filters),
    enabled: !!orgId && !!briefId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      BriefsAPI.listCommits(briefId as string, {
        ...filters,
        limit,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
    // Changing a filter keeps the previous page on screen, so the filter
    // dropdowns (fed by the response's facets) don't empty out mid-request.
    placeholderData: keepPreviousData,
  });
}

export function useDeleteBrief() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (briefId: string) => BriefsAPI.remove(briefId),
    onSuccess: async (_data, briefId) => {
      // Dropped rather than invalidated: the detail query polls, and a refetch
      // of a deleted brief is a guaranteed 404 toast on the way out.
      queryClient.removeQueries({
        queryKey: briefsKeys.detail(orgId, briefId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["briefs", "list", orgId],
      });
    },
  });
}

export function useGenerateBrief() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: GenerateBriefRequest) => BriefsAPI.generate(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["briefs", "list", orgId],
      });
    },
  });
}
