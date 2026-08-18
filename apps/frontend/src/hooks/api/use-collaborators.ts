import { useQuery } from "@tanstack/react-query";
import { CollaboratorsAPI } from "@/api/collaborators.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export const collaboratorsKeys = {
  list: (orgId: string | null) => ["collaborators", "list", orgId] as const,
};

export function useGetCollaborators() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: collaboratorsKeys.list(orgId),
    queryFn: () => CollaboratorsAPI.list(),
    enabled: !!orgId,
  });
}
