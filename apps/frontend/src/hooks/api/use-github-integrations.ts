import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { SetRepositoryBranchesRequest } from "@launchstack/api-interfaces"
import { GithubIntegrationsAPI } from "@/api/github-integrations.api"
import { useActiveOrganizationStore } from "@/stores/active-organization-store"

export const githubKeys = {
  installations: (orgId: string | null) =>
    ["github", "installations", orgId] as const,
  branches: (orgId: string | null, repositoryId: string) =>
    ["github", "branches", orgId, repositoryId] as const,
  ingestStatus: (orgId: string | null) =>
    ["github", "ingest-status", orgId] as const,
}

// Same cadence as the background-jobs toast: fast while work is in flight so the
// onboarding console feels live and its gated CTA unlocks without a refresh,
// slow when idle to keep the ambient cost down. Hidden tabs don't poll.
const INGEST_ACTIVE_INTERVAL_MS = 3000
const INGEST_IDLE_INTERVAL_MS = 20000

/**
 * Per-repository ingest progress. `enabled` is caller-driven because only the
 * onboarding console needs it — every other screen would pay for a poll it never
 * reads.
 */
export function useRepositoryIngestStatus(
  options: { enabled?: boolean } = {},
) {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useQuery({
    queryKey: githubKeys.ingestStatus(activeOrgId),
    queryFn: () => GithubIntegrationsAPI.ingestStatus(),
    enabled: !!activeOrgId && options.enabled !== false,
    refetchInterval: (query) =>
      query.state.data?.data?.ingesting
        ? INGEST_ACTIVE_INTERVAL_MS
        : INGEST_IDLE_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
}

export function useGithubInstallations() {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useQuery({
    queryKey: githubKeys.installations(activeOrgId),
    queryFn: () => GithubIntegrationsAPI.list(),
    enabled: !!activeOrgId,
  })
}

export function useStartGithubConnect() {
  return useMutation({
    mutationFn: () => GithubIntegrationsAPI.start(),
    onSuccess: (res) => {
      window.location.href = res.data.installUrl
    },
  })
}

export function useSyncGithubInstallation() {
  const queryClient = useQueryClient()
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useMutation({
    mutationFn: (installationId: string) =>
      GithubIntegrationsAPI.sync(installationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: githubKeys.installations(activeOrgId),
      })
    },
  })
}

/**
 * Branch list for one repository, live from GitHub. `enabled` is caller-driven
 * so the setup screen can fetch per row as it renders — one request per repo, so
 * a slow repository never blocks the others.
 */
export function useRepositoryBranches(
  repositoryId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useQuery({
    queryKey: githubKeys.branches(activeOrgId, repositoryId ?? ""),
    queryFn: () => GithubIntegrationsAPI.listBranches(repositoryId as string),
    enabled: !!activeOrgId && !!repositoryId && options.enabled !== false,
    // Branch lists move with pushes, but re-fetching on every mount of the
    // setup screen costs a GraphQL call per repo for no decision-relevant change.
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * One query per repository, run together. `useQueries` rather than a fetch in
 * each row so the setup screen can derive prefilled defaults from the results
 * without pushing state back up out of its rows — and so one slow repository
 * still doesn't hold up the others.
 */
export function useRepositoryBranchesBatch(repositoryIds: string[]) {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useQueries({
    queries: repositoryIds.map((repositoryId) => ({
      queryKey: githubKeys.branches(activeOrgId, repositoryId),
      queryFn: () => GithubIntegrationsAPI.listBranches(repositoryId),
      enabled: !!activeOrgId,
      staleTime: 60_000,
      retry: false,
    })),
  })
}

export function useSetRepositoryBranches() {
  const queryClient = useQueryClient()
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useMutation({
    mutationFn: (payload: SetRepositoryBranchesRequest) =>
      GithubIntegrationsAPI.setBranches(payload),
    // Also on error: the one way to fail here is a repository whose branches are
    // already set (stale page, or a second admin), and refetching is what makes
    // the list stop offering it.
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: githubKeys.installations(activeOrgId),
      })
    },
  })
}

export function useDisconnectGithubInstallation() {
  const queryClient = useQueryClient()
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId)
  return useMutation({
    mutationFn: (installationId: string) =>
      GithubIntegrationsAPI.disconnect(installationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: githubKeys.installations(activeOrgId),
      })
    },
  })
}
