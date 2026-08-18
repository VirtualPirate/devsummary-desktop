import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateTeamRequest,
  SetTeamCollaboratorsRequest,
  UpdateTeamRequest,
} from "@launchstack/api-interfaces";
import { TeamsAPI } from "@/api/teams.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const teamsKeys = {
  list: (orgId: string | null) => ["teams", "list", orgId] as const,
  detail: (orgId: string | null, teamId: string) =>
    ["teams", "detail", orgId, teamId] as const,
};

export function useGetTeams() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: teamsKeys.list(orgId),
    queryFn: () => TeamsAPI.list(),
    enabled: !!orgId,
  });
}

export function useGetTeam(teamId: string | undefined) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: teamsKeys.detail(orgId, teamId ?? ""),
    queryFn: () => TeamsAPI.get(teamId as string),
    enabled: !!orgId && !!teamId,
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: CreateTeamRequest) => TeamsAPI.create(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsKeys.list(orgId) });
    },
  });
}

export function useUpdateTeam(teamId: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: UpdateTeamRequest) => TeamsAPI.update(teamId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsKeys.list(orgId) });
      await queryClient.invalidateQueries({
        queryKey: teamsKeys.detail(orgId, teamId),
      });
    },
  });
}

export function useSetTeamCollaborators(teamId: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: SetTeamCollaboratorsRequest) =>
      TeamsAPI.setCollaborators(teamId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsKeys.list(orgId) });
      await queryClient.invalidateQueries({
        queryKey: teamsKeys.detail(orgId, teamId),
      });
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (teamId: string) => TeamsAPI.delete(teamId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: teamsKeys.list(orgId) });
    },
  });
}
