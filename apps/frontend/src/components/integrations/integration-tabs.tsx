import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { GithubMark, SlackMark } from "./provider-marks";

/**
 * The only route between the two integration pages. Without it Slack is
 * reachable only by typing the URL — the sidebar carries a single Integrations
 * item, and adding one row per provider is the nav model variant B proposed and
 * this design rejected.
 */
export function IntegrationTabs({ active }: { active: "github" | "slack" }) {
  const tabs = [
    {
      key: "github" as const,
      label: "GitHub",
      to: "/integrations/github",
      icon: <GithubMark className="size-4" />,
    },
    {
      key: "slack" as const,
      label: "Slack",
      to: "/integrations/slack",
      icon: <SlackMark className="size-4" />,
    },
  ];

  return (
    <nav className="mb-6 flex gap-1 border-b" aria-label="Integrations">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-sm font-medium transition",
            tab.key === active
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.icon}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
