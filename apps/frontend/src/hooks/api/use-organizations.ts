import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateOrganizationRequest,
  TransferOwnershipRequest,
  UpdateOrganizationRequest,
} from "@launchstack/api-interfaces";
import { OrganizationsAPI } from "@/api/organizations.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const organizationsKeys = {
  me: ["organizations", "me"] as const,
  current: (activeOrgId: string | null) =>
    ["organizations", "current", activeOrgId] as const,
};

export function useMyOrganizations() {
  return useQuery({
    queryKey: organizationsKeys.me,
    queryFn: () => OrganizationsAPI.listMine(),
    // Membership changes rarely and mutations invalidate this key explicitly, so
    // a short freshness window keeps the org switcher and
    // useBootstrapActiveOrganization off a refetch treadmill.
    staleTime: 30_000,
  });
}

export function useCurrentOrganization() {
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: organizationsKeys.current(activeOrgId),
    queryFn: () => OrganizationsAPI.getCurrent(),
    enabled: !!activeOrgId,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOrganizationRequest) =>
      OrganizationsAPI.create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationsKeys.me });
    },
  });
}

export function useUpdateCurrentOrganization() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (payload: UpdateOrganizationRequest) =>
      OrganizationsAPI.updateCurrent(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationsKeys.me });
      await queryClient.invalidateQueries({
        queryKey: organizationsKeys.current(activeOrgId),
      });
    },
  });
}

export function useDeleteCurrentOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => OrganizationsAPI.deleteCurrent(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationsKeys.me });
    },
  });
}

export function useTransferOwnership() {
  const queryClient = useQueryClient();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (payload: TransferOwnershipRequest) =>
      OrganizationsAPI.transferOwnership(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationsKeys.me });
      await queryClient.invalidateQueries({
        queryKey: organizationsKeys.current(activeOrgId),
      });
    },
  });
}
