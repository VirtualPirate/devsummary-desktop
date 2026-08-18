import type { ReactNode } from "react";
import { BrandMarkLoader } from "@/components/devsummary/brand-mark-loader";
import { ConnectReposGate } from "@/components/devsummary/shared/connect-repos-gate";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";

/**
 * Takeover for pages that say nothing useful without commit activity (home,
 * briefs, schedules). Returns null once at least one repository is synced:
 *
 *     const gate = useConnectReposGate();
 *     if (gate) return gate;
 *
 * Call it after every other hook in the component — it short-circuits render.
 *
 * Waits on `isPending`, not `isLoading`: the installations query is disabled
 * until the active org id is bootstrapped, and a disabled query is
 * pending-but-not-loading, so gating on `isLoading` flashes the takeover.
 */
export function useConnectReposGate(): ReactNode | null {
  const query = useGithubInstallations();

  if (query.isPending) {
    return (
      <div
        className="flex min-h-[calc(100svh_-_6rem)] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <BrandMarkLoader className="h-9" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  const repos = (query.data?.data ?? []).flatMap((i) => i.repositories);

  if (repos.length === 0) return <ConnectReposGate />;
  // Connected is not the same as working: a repository reads nothing until a
  // branch is chosen, so if none has one, every page behind this gate would
  // render an empty dashboard with no hint that setup is unfinished. A partial
  // configuration is fine — the integrations page banners the remainder.
  if (repos.every((r) => r.branch === null)) {
    return <ConnectReposGate variant="configure" />;
  }
  return null;
}
