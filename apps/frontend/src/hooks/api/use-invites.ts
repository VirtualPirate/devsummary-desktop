import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcceptInviteRequest,
  CreateInviteRequest,
  DeclineInviteRequest,
  InviteStatus,
} from "@launchstack/api-interfaces";
import { InvitesAPI } from "@/api/invites.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import { authSessionQueryKey } from "@/hooks/api/use-auth";

export const invitesKeys = {
  currentOrg: (activeOrgId: string | null, status: InviteStatus | "all") =>
    [
      "organizations",
      "current",
      activeOrgId,
      "invites",
      status,
    ] as const,
  mine: (userId?: string) => ["invites", "me", userId] as const,
  preview: (token: string) => ["invites", "preview", token] as const,
};

export function useCurrentOrganizationInvites(
  status: InviteStatus | "all" = "pending",
) {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: invitesKeys.currentOrg(activeOrgId, status),
    queryFn: () => InvitesAPI.listForCurrentOrg(status),
    enabled: !!activeOrgId,
  });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (payload: CreateInviteRequest) =>
      InvitesAPI.createForCurrentOrg(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", "current", activeOrgId, "invites"],
      });
    },
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (inviteId: string) => InvitesAPI.revoke(inviteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", "current", activeOrgId, "invites"],
      });
    },
  });
}

export function useResendInvite() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (inviteId: string) => InvitesAPI.resend(inviteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", "current", activeOrgId, "invites"],
      });
    },
  });
}

export function useMyPendingInvites(userId?: string) {
  return useQuery({
    queryKey: invitesKeys.mine(userId),
    queryFn: () => InvitesAPI.listMine(),
    enabled: !!userId,
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AcceptInviteRequest) => InvitesAPI.accept(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", "me"],
      });
      await queryClient.invalidateQueries({ queryKey: ["invites", "me"] });
    },
  });
}

export function useDeclineInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: DeclineInviteRequest) => InvitesAPI.decline(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["invites", "me"] });
    },
  });
}

export function useInvitePreview(token: string | undefined) {
  return useQuery({
    queryKey: invitesKeys.preview(token ?? ""),
    queryFn: () => InvitesAPI.preview(token!),
    enabled: !!token,
    retry: false,
  });
}

void authSessionQueryKey;
