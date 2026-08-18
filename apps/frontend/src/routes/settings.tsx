import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Monitor, Moon, Send, Sun } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { GithubPatForm } from "@/components/integrations/github-pat-form";
import { SlackTokenForm } from "@/components/integrations/slack-token-form";
import { SlackTestMessageDialog } from "@/components/integrations/slack-test-message-dialog";
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
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import {
  useLocalSettings,
  useSendTestEmail,
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { useSlackInstallations } from "@/hooks/api/use-slack";
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

/** Green tick when a credential is stored. Never the value — only the boolean. */
function StatusPill({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gb-status-shipped/15 px-2.5 py-0.5 text-xs font-medium text-gb-status-shipped">
      <Check className="size-3" />
      Configured
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      Not set
    </span>
  );
}

function SectionCard({
  title,
  description,
  configured,
  children,
}: {
  title: string;
  description: React.ReactNode;
  configured: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <StatusPill configured={configured} />
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function OpenAiSection({ configured }: { configured: boolean }) {
  const update = useUpdateLocalCredentials();
  const [key, setKey] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = key.trim();
    if (!value) return;
    try {
      await update.mutateAsync({ openaiApiKey: value });
      setKey("");
      toast.success("OpenAI key saved");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <SectionCard
      title="OpenAI"
      description="Classifies each commit and writes the briefs. Billed to your own key."
      configured={configured}
    >
      <form className="max-w-md space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="openai-key">API key</Label>
          <Input
            id="openai-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="sk-…"
            className="font-mono"
          />
        </div>
        <Button type="submit" disabled={!key.trim() || update.isPending}>
          {update.isPending ? "Saving…" : "Save key"}
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">
        Model overrides and running token totals aren&rsquo;t editable here yet —
        both need a backend endpoint that does not exist. Models come from
        <span className="font-mono"> OPENAI_COMMIT_ANALYSIS_MODEL</span> and
        <span className="font-mono"> OPENAI_BRIEF_MODEL</span>; token counts are
        recorded per brief and per commit analysis in the database.
      </p>
    </SectionCard>
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

function NotificationsSection({ enabled }: { enabled: boolean }) {
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
            The database, logs and encrypted secrets live in this app&rsquo;s
            user-data folder. Nothing exposes the path to this screen yet — see
            the Phase 9 receipt.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const settings = useLocalSettings();
  const github = useGithubInstallations();
  const slack = useSlackInstallations();
  const [slackTestOpen, setSlackTestOpen] = useState(false);

  const status = settings.data?.data;
  // GitHub status comes from the installation row rather than the credential
  // booleans: the PAT is stored by the integrations endpoint, which is what
  // ingest actually reads.
  const githubConnected = (github.data?.data ?? []).length > 0;
  const slackConnected = (slack.data?.data ?? []).length > 0;

  const header = (
    <PageHeader
      title="Settings"
      description="Credentials live in this machine's keychain. Nothing is ever read back into the app."
    />
  );

  if (settings.isPending) {
    return (
      <>
        {header}
        <SkeletonList rows={4} rowHeight={160} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[720px]">
      {header}

      <div className="space-y-8">
        <SectionCard
          title="GitHub"
          description="A fine-grained personal access token is the only way in — DevSummary reads commits through your own access."
          configured={githubConnected}
        >
          {githubConnected ? (
            <p className="text-sm text-muted-foreground">
              Connected. Manage repositories, branches and disconnect on the{" "}
              <Link
                to="/integrations/github"
                className="underline underline-offset-4 hover:text-foreground"
              >
                integrations page
              </Link>
              . Pasting a new token below replaces the stored one.
            </p>
          ) : null}
          <div className={githubConnected ? "mt-4" : undefined}>
            <GithubPatForm onConnected="stay" />
          </div>
        </SectionCard>

        <OpenAiSection configured={status?.openai ?? false} />

        <SmtpSection
          configured={status?.smtp ?? false}
          fromConfigured={status?.emailFrom ?? false}
        />

        <SectionCard
          title="Slack"
          description="A bot token posts briefs into a channel. The channel is chosen per schedule."
          configured={slackConnected}
        >
          {slackConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connected. Channel membership and disconnect live on the{" "}
                <Link
                  to="/integrations/slack"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  integrations page
                </Link>
                .
              </p>
              <Button variant="outline" onClick={() => setSlackTestOpen(true)}>
                <Send className="size-3.5" />
                Post a test message
              </Button>
            </div>
          ) : (
            <SlackTokenForm />
          )}
        </SectionCard>

        <NotificationsSection
          enabled={status?.desktopNotifications ?? false}
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
      </div>

      <SlackTestMessageDialog
        open={slackTestOpen}
        onOpenChange={setSlackTestOpen}
      />
    </div>
  );
}
