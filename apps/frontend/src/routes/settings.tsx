import { Link } from "@tanstack/react-router";
import { Download, FolderOpen, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { EmailVerificationCard } from "@/components/integrations/email-verification-card";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { Switch } from "@/components/ui/switch";
import {
  useLocalSettings,
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";
import { useAppUpdates } from "@/hooks/use-app-updates";

// `shell.openPath` reports failure by resolving to a message rather than throwing,
// so an unopenable directory has to be read off the resolved value or it is silent.
async function openDataDir() {
  const error = await window.desktop?.openDataDir();
  if (error) toast.error(error);
}

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex gap-1 rounded-full border bg-card p-1 shadow-e1">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
            theme === value
              ? "bg-brand/12 text-brand"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

function NotificationsSection({
  enabled,
  dataDir,
}: {
  enabled: boolean;
  dataDir: string;
}) {
  const update = useUpdateLocalCredentials();

  const handleToggle = async (next: boolean) => {
    try {
      await update.mutateAsync({ desktopNotifications: next });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Desktop</CardTitle>
        <CardDescription>
          How this machine behaves once a brief is ready.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Desktop notifications</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              How a finished brief reaches you — briefs are always readable on
              the dashboard.
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void handleToggle(next)}
            disabled={update.isPending}
            aria-label="Desktop notifications"
          />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">Theme</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Applies to this app only.
            </div>
          </div>
          <ThemePicker />
        </div>

        <div className="h-px bg-border" />

        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Data directory</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                The database, logs and encrypted secrets live here. Something
                went wrong? The newest{" "}
                <span className="font-mono">logs/app.log.*</span> is what a bug
                report needs — the log rolls, so the number changes.
              </div>
            </div>
            {window.desktop ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void openDataDir()}
              >
                <FolderOpen className="size-3.5" />
                Open
              </Button>
            ) : null}
          </div>
          <div className="mt-2 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs break-all">
            {dataDir}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function UpdatesSection() {
  const { state, currentVersion, enabled, canInstall, setEnabled, checkNow, install } =
    useAppUpdates();

  const result =
    state.status === "available"
      ? `Version ${state.version} is available.`
      : state.status === "downloading"
        ? `Downloading… ${state.percent}%`
        : state.status === "ready"
          ? `Version ${state.version} is ready to install.`
          : state.status === "error"
            ? `Last check failed: ${state.message}`
            : "Up to date.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          How this machine gets new versions of DevSummary.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Automatic updates</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Asks <span className="font-mono">github.com</span> every six hours
              whether a newer version exists, and downloads it in the background.
              GitHub sees the request — an IP address and an app version, with no
              account attached. Switch this off and nothing is asked.
            </div>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void setEnabled(next)}
            disabled={!window.desktop}
            aria-label="Automatic updates"
          />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">
              Version <span className="font-mono">{currentVersion || "—"}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{result}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => void checkNow()} disabled={!window.desktop}>
              <RefreshCw className="size-3.5" />
              Check now
            </Button>
            {state.status === "ready" || (state.status === "available" && !canInstall) ? (
              <Button size="sm" onClick={() => void install()}>
                {canInstall ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />}
                {canInstall ? "Restart now" : "Download"}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const settings = useLocalSettings();

  const status = settings.data?.data;

  const header = (
    <PageHeader
      title="Settings"
      description="Credentials are encrypted on this machine by your OS credential store. Nothing is ever read back into the app."
    />
  );

  if (settings.isPending) {
    return (
      <>
        {header}
        <SkeletonList rows={3} rowHeight={160} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[720px]">
      {header}

      <div className="space-y-8">
        <NotificationsSection
          enabled={status?.desktopNotifications ?? false}
          dataDir={status?.dataDir ?? ""}
        />

        <EmailVerificationCard />

        <UpdatesSection />

        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              Projects, teams, schedules and briefs are scoped to a workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/settings/organization">Workspace settings</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/organizations/new">New workspace</Link>
            </Button>
          </CardContent>
        </Card>

        {/* GitHub and the AI provider key both live on the integrations pages
            now — one place per provider, rather than a paste form here and a
            management page there. */}
        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>
              GitHub and AI provider credentials are managed on their own pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/integrations/github">GitHub</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/integrations/ai">AI</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
