import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { EmailAuthForm } from "@/components/auth/email-auth-form";
import { RandomAuthBackdrop } from "@/components/auth/backdrops/auth-backdrop";
import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSignInEmail } from "@/hooks/api/use-auth";
import {
  DEFAULT_AUTH_REDIRECT_PATH,
  GOOGLE_SIGN_IN_ROUTE_PATH,
  buildAuthRouteWithRedirect,
  normalizeRedirectPath,
  toAbsoluteCallbackURL,
} from "@/lib/auth-redirect";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return fallback;
}

export function SignInPage() {
  const search = useSearch({ strict: false }) as {
    redirect?: string;
    reset?: "success";
  };
  const redirectTo = normalizeRedirectPath(search.redirect);
  const callbackURL = toAbsoluteCallbackURL(redirectTo);

  const signInEmail = useSignInEmail();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);

  const handleEmailSignIn = async (values: {
    name?: string;
    email: string;
    password: string;
  }) => {
    setErrorMessage(null);

    const result = await signInEmail.mutateAsync({
      email: values.email,
      password: values.password,
      callbackURL,
    });

    if (result.error) {
      setErrorMessage(getErrorMessage(result.error, "Unable to sign in."));
      return;
    }

    window.location.assign(redirectTo);
  };

  const handleGoogleSignIn = () => {
    setErrorMessage(null);
    setIsGoogleRedirecting(true);
    window.location.assign(
      buildAuthRouteWithRedirect(GOOGLE_SIGN_IN_ROUTE_PATH, redirectTo),
    );
  };

  return (
    <>
      <RandomAuthBackdrop />
      <AuthThemeToggle />
      <div className="mx-auto flex min-h-screen w-full max-w-sm items-center px-4 py-10">
        <Card className="w-full gap-6 p-7 shadow-e2 sm:p-8">
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex items-center gap-2">
              <BrandMark />
              <span className="text-base font-semibold tracking-tight">
                DevSummary
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
              <p className="text-sm text-balance text-muted-foreground">
                Welcome back — sign in to catch up on your team&rsquo;s latest
                briefs.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {search.reset === "success" ? (
              <div
                className="rounded-xl border border-gb-status-shipped/30 bg-gb-status-shipped/10 p-3 text-sm text-gb-status-shipped"
                role="status"
              >
                Password updated. Sign in with your new password.
              </div>
            ) : null}

            <EmailAuthForm
              mode="sign-in"
              isPending={signInEmail.isPending}
              errorMessage={errorMessage}
              onSubmit={handleEmailSignIn}
            />

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                or
              </span>
              <Separator className="flex-1" />
            </div>

            <GoogleAuthButton
              isPending={isGoogleRedirecting}
              onClick={handleGoogleSignIn}
            />
          </div>

          <p className="text-center text-sm text-muted-foreground">
            New to DevSummary?{" "}
            <Link
              to="/sign-up"
              search={
                redirectTo === DEFAULT_AUTH_REDIRECT_PATH
                  ? {}
                  : { redirect: redirectTo }
              }
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
