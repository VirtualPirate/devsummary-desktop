import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlackAPI } from "@/api/slack.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const slackKeys = {
  installations: (orgId: string | null) =>
    ["slack", "installations", orgId] as const,
  channels: (orgId: string | null) => ["slack", "channels", orgId] as const,
};

export function useSlackInstallations() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: slackKeys.installations(orgId),
    queryFn: () => SlackAPI.listInstallations(),
    enabled: !!orgId,
    // Every Slack endpoint is admin-only, so a viewer gets a 403 that will
    // never turn into a 200 — retrying it three times only delays the
    // permission notice the page wants to show.
    retry: false,
  });
}

/**
 * Whether Slack delivery can be configured at all. The delivery field used to
 * derive this from `useGithubInstallations()`, which unlocked the Slack channel
 * input as soon as *GitHub* was connected — the backend then rejected the save
 * with SLACK_INSTALLATION_NOT_FOUND.
 */
export function useSlackAvailable(): boolean {
  const query = useSlackInstallations();
  return (query.data?.data ?? []).length > 0;
}

export function useStartSlackConnect() {
  return useMutation({
    mutationFn: () => SlackAPI.start(),
    onSuccess: (res) => {
      window.location.href = res.data.installUrl;
    },
  });
}

export function useDisconnectSlackInstallation() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (installationId: string) => SlackAPI.disconnect(installationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: slackKeys.installations(orgId),
      });
      queryClient.removeQueries({ queryKey: slackKeys.channels(orgId) });
    },
  });
}

/**
 * Channel list, live from Slack. `enabled` is caller-driven: it costs a paged
 * `conversations.list` per workspace, so only the screens that render channel
 * names ask for it.
 */
export function useSlackChannels(options: { enabled?: boolean } = {}) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: slackKeys.channels(orgId),
    queryFn: () => SlackAPI.listChannels(),
    enabled: !!orgId && options.enabled !== false,
    staleTime: 60_000,
    retry: false,
  });
}

export function useJoinSlackChannel() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (channelId: string) => SlackAPI.joinChannel(channelId),
    onSuccess: async () => {
      // `isMember` is what the "not in channel" warning reads, and it only
      // changes on Slack's side — refetch rather than patch the cache.
      await queryClient.invalidateQueries({
        queryKey: slackKeys.channels(orgId),
      });
    },
  });
}

export function useSendSlackTestMessage() {
  return useMutation({
    mutationFn: (payload: { channelId: string; text: string }) =>
      SlackAPI.postMessage(payload),
  });
}
