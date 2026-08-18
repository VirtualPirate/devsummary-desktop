import { useEffect } from "react";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import { useMyOrganizations } from "@/hooks/api/use-organizations";

export function useBootstrapActiveOrganization() {
  const { data, isSuccess, isFetching, isFetchedAfterMount } =
    useMyOrganizations();
  const activeOrganizationId = useActiveOrganizationStore(
    (s) => s.activeOrganizationId,
  );
  const setActiveOrganizationId = useActiveOrganizationStore(
    (s) => s.setActiveOrganizationId,
  );

  // A list we actually fetched during this mount, with nothing else in flight,
  // is the only one we trust enough to drop a deliberate selection. React Query
  // serves the cached list first (and keeps it while refetching), and treating
  // "absent from a possibly-stale list" as "gone" permanently reassigns the
  // user to orgs[0].
  const listIsFresh = isFetchedAfterMount && !isFetching;

  useEffect(() => {
    if (!isSuccess || !data?.data) return;
    const orgs = data.data;
    const stillPresent = orgs.some(
      (entry) => entry.organization.id === activeOrganizationId,
    );
    if (activeOrganizationId && !stillPresent) {
      if (listIsFresh) setActiveOrganizationId(null);
      return;
    }
    if (!activeOrganizationId && orgs.length > 0) {
      setActiveOrganizationId(orgs[0].organization.id);
    }
  }, [
    isSuccess,
    listIsFresh,
    data,
    activeOrganizationId,
    setActiveOrganizationId,
  ]);
}
