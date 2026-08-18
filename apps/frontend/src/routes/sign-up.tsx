import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { EmailAuthForm } from "@/components/auth/email-auth-form";
import { RandomAuthBackdrop } from "@/components/auth/backdrops/auth-backdrop";
import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSignUpEmail } from "@/hooks/api/use-auth";
import {
  DEFAULT_AUTH_REDIRECT_PATH,
  GOOGLE_SIGN_UP_ROUTE_PATH,
  buildVerifyEmailRoute,
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

export function SignUpPage() {
  const search = useSearch({ strict: false }) as { redirect?: string; email?: string };
  const redirectTo = normalizeRedirectPath(search.redirect);
  const callbackURL = toAbsoluteCallbackURL(redirectTo);

  const signUpEmail = useSignUpEmail();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);

  const handleEmailSignUp = async (values: {
    name?: string;
    email: string;
    password: string;
  }) => {
    setErrorMessage(null);

    if (!values.name) {
      setErrorMessage("Name is required.");
      return;
    }

    const result = await signUpEmail.mutateAsync({
      name: values.name,
      email: values.email,
      password: values.password,
      callbackURL,
    });

    if (result.error) {
      setErrorMessage(getErrorMessage(result.error, "Unable to create account."));
      return;
    }

    window.location.assign(buildVerifyEmailRoute(values.email, redirectTo));
  };

  const handleGoogleSignUp = () => {
    setErrorMessage(null);
    setIsGoogleRedirecting(true);
    window.location.assign(
      buildAuthRouteWithRedirect(GOOGLE_SIGN_UP_ROUTE_PATH, redirectTo),
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
              <h1 className="text-2xl font-semibold tracking-tight">
                Create your account
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                Turn your team&rsquo;s GitHub activity into plain-English briefs.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <EmailAuthForm
              mode="sign-up"
              isPending={signUpEmail.isPending}
              errorMessage={errorMessage}
              initialEmail={search.email ?? ""}
              onSubmit={handleEmailSignUp}
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
              onClick={handleGoogleSignUp}
            />
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/sign-in"
              search={
                redirectTo === DEFAULT_AUTH_REDIRECT_PATH
                  ? {}
                  : { redirect: redirectTo }
              }
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
