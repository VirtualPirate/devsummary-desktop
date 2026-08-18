import { useSearch } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { AuthAPI } from "@/api/auth.api";
import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Card } from "@/components/ui/card";
import {
  buildAuthErrorRoute,
  normalizeRedirectPath,
  toAbsoluteAuthErrorCallbackURL,
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

export function GoogleSignUpPage() {
  const search = useSearch({ strict: false }) as { redirect?: string };
  const redirectTo = normalizeRedirectPath(search.redirect);

  useEffect(() => {
    const startGoogleSignUp = async () => {
      try {
        const callbackURL = toAbsoluteCallbackURL(redirectTo);
        const result = await AuthAPI.signInWithGoogle({
          callbackURL,
          newUserCallbackURL: callbackURL,
          errorCallbackURL: toAbsoluteAuthErrorCallbackURL(
            redirectTo,
            "sign-up",
          ),
          disableRedirect: true,
          requestSignUp: true,
        });

        if (result.error) {
          const errorMessage = getErrorMessage(
            result.error,
            "Google sign-up could not be started.",
          );
          window.location.assign(
            buildAuthErrorRoute({
              redirect: redirectTo,
              mode: "sign-up",
              message: errorMessage,
            }),
          );
          return;
        }

        if (result.data?.url) {
          window.location.assign(result.data.url);
          return;
        }

        window.location.assign(redirectTo);
      } catch (error) {
        const errorMessage = getErrorMessage(
          error,
          "Google sign-up could not be started.",
        );
        window.location.assign(
          buildAuthErrorRoute({
            redirect: redirectTo,
            mode: "sign-up",
            message: errorMessage,
          }),
        );
      }
    };

    void startGoogleSignUp();
  }, [redirectTo]);

  return (
    <>
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
                Redirecting to Google
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                Hang tight while we hand you off to Google to finish creating
                your account.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <Loader2 className="size-6 animate-spin text-brand" />
          </div>
        </Card>
      </div>
    </>
  );
}
