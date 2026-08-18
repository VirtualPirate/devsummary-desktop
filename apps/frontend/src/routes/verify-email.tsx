import { Link, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_AUTH_REDIRECT_PATH,
  normalizeRedirectPath,
} from "@/lib/auth-redirect";
import { useSendVerificationOtp, useVerifyEmailOtp } from "@/hooks/api/use-auth";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }

    const response = (error as { response?: { data?: { message?: unknown } } })
      .response;
    const responseMessage = response?.data?.message;
    if (typeof responseMessage === "string" && responseMessage.length > 0) {
      return responseMessage;
    }
  }

  return fallback;
}

export function VerifyEmailPage() {
  const search = useSearch({ strict: false }) as {
    redirect?: string;
    email?: string;
  };

  const redirectTo = normalizeRedirectPath(search.redirect);
  const email = typeof search.email === "string" ? search.email : "";

  const [otp, setOtp] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const verifyEmailOtp = useVerifyEmailOtp();
  const sendVerificationOtp = useSendVerificationOtp();

  const maskedEmail = useMemo(() => {
    if (!email.includes("@")) {
      return email;
    }

    const [local, domain] = email.split("@");
    if (local.length <= 2) {
      return `${"*".repeat(local.length)}@${domain}`;
    }

    return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }, [email]);

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email) {
      setErrorMessage("Missing email. Please sign up again.");
      return;
    }

    const normalizedOtp = otp.trim();
    if (normalizedOtp.length !== 6) {
      setErrorMessage("Enter the 6-digit code sent to your email.");
      return;
    }

    try {
      await verifyEmailOtp.mutateAsync({
        email,
        otp: normalizedOtp,
      });
      window.location.assign(redirectTo);
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, "That code didn't work. Try again."),
      );
    }
  };

  const handleResendCode = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email) {
      setErrorMessage("Missing email. Please sign up again.");
      return;
    }

    try {
      await sendVerificationOtp.mutateAsync({
        email,
        type: "email-verification",
      });
      setSuccessMessage("A new verification code is on its way.");
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, "Couldn't resend the code. Try again."),
      );
    }
  };

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
                Verify your email
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                Enter the 6-digit code we sent to{" "}
                <span className="font-medium text-foreground">
                  {maskedEmail || "your email"}
                </span>
                .
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <form className="flex flex-col gap-4" onSubmit={handleVerify}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="otp">Verification code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  className="text-center font-mono tracking-[0.3em]"
                  placeholder="123456"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </div>

              {errorMessage ? (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              {successMessage ? (
                <p className="text-sm text-gb-status-shipped" role="status">
                  {successMessage}
                </p>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={verifyEmailOtp.isPending}
              >
                {verifyEmailOtp.isPending ? "Verifying…" : "Verify email"}
              </Button>
            </form>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleResendCode}
              disabled={sendVerificationOtp.isPending}
            >
              {sendVerificationOtp.isPending ? "Resending…" : "Resend code"}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Want to use another email?{" "}
            <Link
              to="/sign-up"
              search={
                redirectTo === DEFAULT_AUTH_REDIRECT_PATH
                  ? {}
                  : { redirect: redirectTo }
              }
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              Create account
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
