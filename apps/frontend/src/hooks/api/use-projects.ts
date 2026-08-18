import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateProjectRequest,
  SetProjectRepositoriesRequest,
  UpdateProjectRequest,
} from "@launchstack/api-interfaces";
import { ProjectsAPI } from "@/api/projects.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const projectsKeys = {
  all: (orgId: string | null) => ["projects", orgId] as const,
  list: (orgId: string | null) => ["projects", "list", orgId] as const,
  detail: (orgId: string | null, projectId: string) =>
    ["projects", "detail", orgId, projectId] as const,
};

export function useGetProjects() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: projectsKeys.list(orgId),
    queryFn: () => ProjectsAPI.list(),
    enabled: !!orgId,
  });
}

export function useGetProject(projectId: string | undefined) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: projectsKeys.detail(orgId, projectId ?? ""),
    queryFn: () => ProjectsAPI.get(projectId as string),
    enabled: !!orgId && !!projectId,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: CreateProjectRequest) => ProjectsAPI.create(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKeys.list(orgId) });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: UpdateProjectRequest) =>
      ProjectsAPI.update(projectId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKeys.list(orgId) });
      await queryClient.invalidateQueries({
        queryKey: projectsKeys.detail(orgId, projectId),
      });
    },
  });
}

export function useSetProjectRepositories(projectId: string) {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (data: SetProjectRepositoriesRequest) =>
      ProjectsAPI.setRepositories(projectId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKeys.list(orgId) });
      await queryClient.invalidateQueries({
        queryKey: projectsKeys.detail(orgId, projectId),
      });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useMutation({
    mutationFn: (projectId: string) => ProjectsAPI.delete(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKeys.list(orgId) });
    },
  });
}
