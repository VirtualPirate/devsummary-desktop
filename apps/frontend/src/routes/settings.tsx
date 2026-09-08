import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Monitor, Moon, Send, Sun } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { SectionCard } from "@/components/devsummary/shared/section-card";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { Switch } from "@/components/ui/switch";
import {
  useLocalSettings,
  useSendTestEmail,
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";

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

function SmtpSection({
  configured,
  fromConfigured,
}: {
  configured: boolean;
  fromConfigured: boolean;
}) {
  const update = useUpdateLocalCredentials();
  const testEmail = useSendTestEmail();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [testTo, setTestTo] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Omitted keys are left alone server-side, so a partial edit (just the
    // password, say) does not blank the rest.
    const payload: Record<string, string | number> = {};
    if (host.trim()) payload.smtpHost = host.trim();
    if (port.trim()) payload.smtpPort = Number(port);
    if (user.trim()) payload.smtpUser = user.trim();
    if (pass) payload.smtpPass = pass;
    if (from.trim()) payload.emailFrom = from.trim();
    if (Object.keys(payload).length === 0) return;
    try {
      // The backend runs `transporter.verify()` before storing, so a typo'd app
      // password is a red field here rather than a failed brief days later.
      await update.mutateAsync(payload);
      setPass("");
      toast.success("SMTP settings saved");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleTest = async () => {
    const to = testTo.trim();
    if (!to) return;
    try {
      const res = await testEmail.mutateAsync({ to });
      toast.success(res.data.detail);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <SectionCard
      title="Email (SMTP)"
      description="Your own mailbox sends the briefs — a Gmail app password, Fastmail, or a company relay."
      configured={configured && fromConfigured}
    >
      <form className="max-w-md space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <div className="space-y-1.5">
            <Label htmlFor="smtp-host">Host</Label>
            <Input
              id="smtp-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="smtp.gmail.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              type="number"
              value={port}
              onChange={(event) => setPort(event.target.value)}
              min={1}
              max={65535}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="smtp-user">Username</Label>
          <Input
            id="smtp-user"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder="you@example.com"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="smtp-pass">Password</Label>
          <Input
            id="smtp-pass"
            type="password"
            value={pass}
            onChange={(event) => setPass(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="smtp-from">From address</Label>
          <Input
            id="smtp-from"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="DevSummary <you@example.com>"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Verifying…" : "Save and verify"}
        </Button>
      </form>

      <div className="mt-6 max-w-md space-y-1.5 border-t pt-4">
        <Label htmlFor="smtp-test-to">Send a test email</Label>
        <div className="flex gap-2">
          <Input
            id="smtp-test-to"
            type="email"
            value={testTo}
            onChange={(event) => setTestTo(event.target.value)}
            placeholder="you@example.com"
          />
          <Button
            variant="outline"
            onClick={() => void handleTest()}
            disabled={!testTo.trim() || testEmail.isPending}
          >
            <Send className="size-3.5" />
            {testEmail.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </SectionCard>
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
              A delivered brief counts as landing here even when email and Slack
              both fail.
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
          <div className="text-sm font-medium">Data directory</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            The database, logs and encrypted secrets live here.
          </div>
          <div className="mt-2 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs break-all">
            {dataDir}
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
        <SmtpSection
          configured={status?.smtp ?? false}
          fromConfigured={status?.emailFrom ?? false}
        />

        <NotificationsSection
          enabled={status?.desktopNotifications ?? false}
          dataDir={status?.dataDir ?? ""}
        />

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

        {/* GitHub, Slack and the OpenAI key all live on the integrations pages
            now — one place per provider, rather than a paste form here and a
            management page there. */}
        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>
              GitHub, Slack and AI provider credentials are managed on their own
              pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/integrations/github">GitHub</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/integrations/slack">Slack</Link>
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
