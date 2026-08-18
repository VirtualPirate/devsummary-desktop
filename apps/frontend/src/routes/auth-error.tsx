import { AlertTriangle } from "lucide-react";
import { useSearch } from "@tanstack/react-router";

import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  GOOGLE_SIGN_IN_ROUTE_PATH,
  GOOGLE_SIGN_UP_ROUTE_PATH,
  buildAuthRouteWithRedirect,
  normalizeRedirectPath,
} from "@/lib/auth-redirect";

type AuthMode = "sign-in" | "sign-up";

type AuthErrorSearch = {
  redirect?: string;
  message?: string;
  error?: string;
  error_description?: string;
  mode?: string;
};

function resolveMode(mode?: string): AuthMode {
  return mode === "sign-up" ? "sign-up" : "sign-in";
}

function resolveErrorMessage(search: AuthErrorSearch, mode: AuthMode) {
  if (typeof search.message === "string" && search.message.length > 0) {
    return search.message;
  }

  if (
    typeof search.error_description === "string" &&
    search.error_description.length > 0
  ) {
    return search.error_description;
  }

  if (typeof search.error === "string" && search.error.length > 0) {
    return search.error;
  }

  if (mode === "sign-up") {
    return "Google didn't finish creating your account. Try again below.";
  }

  return "Google didn't finish signing you in. Try again below.";
}

export function AuthErrorPage() {
  const search = useSearch({ strict: false }) as AuthErrorSearch;
  const mode = resolveMode(search.mode);
  const redirectTo = normalizeRedirectPath(search.redirect);
  const errorMessage = resolveErrorMessage(search, mode);

  const retryGoogleHref = buildAuthRouteWithRedirect(
    mode === "sign-up" ? GOOGLE_SIGN_UP_ROUTE_PATH : GOOGLE_SIGN_IN_ROUTE_PATH,
    redirectTo,
  );
  const authPageHref = buildAuthRouteWithRedirect(
    mode === "sign-up" ? "/sign-up" : "/sign-in",
    redirectTo,
  );

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
            <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" />
            </span>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {mode === "sign-up"
                  ? "Google sign-up didn't finish"
                  : "Google sign-in didn't finish"}
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                {errorMessage}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <a href={retryGoogleHref}>Try Google again</a>
            </Button>
            <Button asChild className="w-full" variant="outline">
              <a href={authPageHref}>
                {mode === "sign-up" ? "Back to sign up" : "Back to sign in"}
              </a>
            </Button>
            <Button asChild className="w-full" variant="ghost">
              <a href={redirectTo}>Continue to app</a>
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
