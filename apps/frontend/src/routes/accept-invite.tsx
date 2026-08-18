import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { colorFromString } from "@/lib/entity-color";
import { useAuthSession } from "@/hooks/api/use-auth";
import {
  useAcceptInvite,
  useDeclineInvite,
  useInvitePreview,
} from "@/hooks/api/use-invites";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export function AcceptInvitePage() {
  const search = useSearch({ strict: false }) as { token?: string };
  const token = typeof search.token === "string" ? search.token : undefined;
  const preview = useInvitePreview(token);
  const session = useAuthSession();
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const navigate = useNavigate();
  const setActive = useActiveOrganizationStore((s) => s.setActiveOrganizationId);

  if (!token) {
    return (
      <>
        <AuthThemeToggle />
        <Centered>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid invite link</CardTitle>
            <CardDescription>The token is missing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/sign-in">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </Centered>
      </>
    );
  }

  if (preview.isLoading || session.isLoading) {
    return (
      <>
        <AuthThemeToggle />
        <Centered>
        <p className="text-sm text-muted-foreground">Loading invite…</p>
      </Centered>
      </>
    );
  }

  if (preview.isError || !preview.data?.success || !preview.data.data.organizationName) {
    return (
      <>
        <AuthThemeToggle />
        <Centered>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
            <CardDescription>
              This invite is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/sign-in">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </Centered>
      </>
    );
  }

  const data = preview.data.data;
  const user = session.data?.data?.user;
  const signedIn = !!session.data?.data?.session;
  const verified = user?.emailVerified === true;
  const emailMatches =
    user?.email?.toLowerCase() === data.invitedEmail.toLowerCase();

  if (!signedIn) {
    const redirectUrl = `/accept-invite?token=${encodeURIComponent(token)}`;
    return (
      <>
        <AuthThemeToggle />
        <Centered>
        <InvitePreviewCard data={data} />
        <div className="flex gap-2">
          <Button asChild>
            <Link
              to="/sign-up"
              search={{ redirect: redirectUrl, email: data.invitedEmail }}
            >
              Sign up to accept
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/sign-in" search={{ redirect: redirectUrl }}>
              Sign in
            </Link>
          </Button>
        </div>
      </Centered>
      </>
    );
  }

  if (!verified) {
    const redirectUrl = `/accept-invite?token=${encodeURIComponent(token)}`;
    return (
      <>
        <AuthThemeToggle />
        <Centered>
        <InvitePreviewCard data={data} />
        <Button asChild>
          <Link
            to="/verify-email"
            search={{ redirect: redirectUrl, email: user?.email }}
          >
            Verify email to continue
          </Link>
        </Button>
      </Centered>
      </>
    );
  }

  if (!emailMatches) {
    return (
      <>
        <AuthThemeToggle />
        <Centered>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Email mismatch</CardTitle>
            <CardDescription>
              This invite was sent to <strong>{data.invitedEmail}</strong>, but
              you&apos;re signed in as <strong>{user?.email}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link to="/sign-in">Switch accounts</Link>
            </Button>
          </CardContent>
        </Card>
      </Centered>
      </>
    );
  }

  const handleAccept = async () => {
    const result = await accept.mutateAsync({ token });
    setActive(result.data.organization.id);
    await navigate({ to: "/" });
  };

  return (
    <>
      <AuthThemeToggle />
      <Centered>
      <InvitePreviewCard data={data} />
      <div className="flex gap-2">
        <Button onClick={handleAccept} disabled={accept.isPending}>
          {accept.isPending ? "Accepting…" : "Accept invite"}
        </Button>
        <Button
          variant="outline"
          onClick={() => decline.mutate({ token })}
          disabled={decline.isPending}
        >
          Decline
        </Button>
      </div>
    </Centered>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-10">
      {children}
    </div>
  );
}

function InvitePreviewCard({
  data,
}: {
  data: {
    organizationName: string;
    inviterName: string | null;
    invitedEmail: string;
    role: "admin" | "viewer";
    expiresAt: string;
  };
}) {
  return (
    <Card className="w-full">
      <CardHeader className="text-center">
        <div
          aria-hidden
          className="mx-auto mb-2 grid size-12 place-items-center rounded-2xl text-lg font-bold text-white"
          style={{ background: colorFromString(data.organizationName) }}
        >
          {data.organizationName.trim().charAt(0).toUpperCase() || "?"}
        </div>
        <CardTitle>Join {data.organizationName}</CardTitle>
        <CardDescription>
          {data.inviterName ?? "Someone"} invited you to{" "}
          <strong>{data.organizationName}</strong> as <strong>{data.role}</strong>.
          Invite expires {new Date(data.expiresAt).toLocaleDateString()}.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground">
        This invite is for {data.invitedEmail}.
      </CardContent>
    </Card>
  );
}
