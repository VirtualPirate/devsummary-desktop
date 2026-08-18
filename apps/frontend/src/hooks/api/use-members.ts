import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateMemberRoleRequest } from "@launchstack/api-interfaces";
import { MembersAPI } from "@/api/members.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const membersKeys = {
  list: (activeOrgId: string | null) =>
    ["organizations", "current", activeOrgId, "members"] as const,
};

export function useCurrentOrganizationMembers() {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: membersKeys.list(activeOrgId),
    queryFn: () => MembersAPI.listCurrent(),
    enabled: !!activeOrgId,
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (input: {
      memberId: string;
      payload: UpdateMemberRoleRequest;
    }) => MembersAPI.updateRole(input.memberId, input.payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: membersKeys.list(activeOrgId),
      });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (memberId: string) => MembersAPI.remove(memberId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: membersKeys.list(activeOrgId),
      });
    },
  });
}

export function useLeaveOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => MembersAPI.leave(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", "me"],
      });
    },
  });
}
