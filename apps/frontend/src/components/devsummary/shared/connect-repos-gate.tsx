import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { GithubMark } from "@/components/integrations/provider-marks";

const STEPS = ["Connect", "Schedule", "Read"];

/**
 * Full-page "there is nothing to show" takeover. Rendered directly by the GitHub
 * integrations page; every other page reaches it via `useConnectReposGate`.
 *
 * Two reasons a page can have no activity to show, and they need different
 * instructions: nothing is connected, or repositories are connected but none of
 * them follows a branch — which reads nothing at all, so the dashboard would
 * otherwise sit empty looking healthy.
 */
export function ConnectReposGate({
  variant = "connect",
}: {
  variant?: "connect" | "configure";
}) {
  const configure = variant === "configure";

  return (
    <div className="flex min-h-[calc(100svh_-_6rem)] flex-col items-center justify-center gap-5 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border bg-card shadow-e1">
        <GithubMark className="size-8" />
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {configure
            ? "No repositories are being read yet"
            : "No repositories connected yet"}
        </h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {configure
            ? "Your repositories are connected, but none of them has a branch selected — so no commits are being read. Choose one to start collecting activity."
            : "Connect GitHub with a personal access token to sync repositories and start collecting commit activity."}
        </p>
      </div>

      {configure ? (
        <Button asChild>
          <Link to="/integrations/github/setup">Choose a branch</Link>
        </Button>
      ) : (
        <Button asChild>
          <Link to="/integrations/github">
            <GithubMark className="size-4" />
            Connect GitHub
          </Link>
        </Button>
      )}

      <ol className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {STEPS.map((step, i) => (
          <li
            key={step}
            className="rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground"
          >
            {i + 1} · {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
