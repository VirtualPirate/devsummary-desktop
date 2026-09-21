import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { GithubMark } from "./provider-marks";

/**
 * The only route between the integration pages. Without it AI is reachable
 * only by typing the URL — the sidebar carries a single Integrations
 * item, and adding one row per provider is the nav model variant B proposed and
 * this design rejected.
 */
export function IntegrationTabs({
  active,
}: {
  active: "github" | "ai";
}) {
  const tabs = [
    {
      key: "github" as const,
      label: "GitHub",
      to: "/integrations/github",
      icon: <GithubMark className="size-4" />,
    },
    {
      key: "ai" as const,
      label: "AI",
      to: "/integrations/ai",
      icon: <Sparkles className="size-4" />,
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
