import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateBriefScheduleRequest,
  UpdateBriefScheduleRequest,
} from "@launchstack/api-interfaces";
import { BriefSchedulesAPI } from "@/api/brief-schedules.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const briefSchedulesKeys = {
  list: (orgId: string | null) => ["brief-schedules", "list", orgId] as const,
  detail: (orgId: string | null, id: string) =>
    ["brief-schedules", "detail", orgId, id] as const,
};

export function useGetBriefSchedules() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: briefSchedulesKeys.list(orgId),
    queryFn: () => BriefSchedulesAPI.list(),
    enabled: !!orgId,
  });
}

export function useGetBriefSchedule(id: string | undefined) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: briefSchedulesKeys.detail(orgId, id ?? ""),
    queryFn: () => BriefSchedulesAPI.get(id as string),
    enabled: !!orgId && !!id,
  });
}

export function useCreateBriefSchedule() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: CreateBriefScheduleRequest) =>
      BriefSchedulesAPI.create(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.list(orgId),
      });
    },
  });
}

export function useUpdateBriefSchedule(id: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: UpdateBriefScheduleRequest) =>
      BriefSchedulesAPI.update(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.list(orgId),
      });
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.detail(orgId, id),
      });
    },
  });
}

export function usePauseBriefSchedule() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (id: string) => BriefSchedulesAPI.pause(id),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.list(orgId),
      });
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.detail(orgId, id),
      });
    },
  });
}

export function useResumeBriefSchedule() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (id: string) => BriefSchedulesAPI.resume(id),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.list(orgId),
      });
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.detail(orgId, id),
      });
    },
  });
}

export function useDeleteBriefSchedule() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (id: string) => BriefSchedulesAPI.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: briefSchedulesKeys.list(orgId),
      });
    },
  });
}
