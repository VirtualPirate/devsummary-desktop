import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import {
  useResetPasswordWithOtp,
  useSendVerificationOtp,
} from "@/hooks/api/use-auth";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return fallback;
}

function mapResetErrorMessage(error: unknown): string {
  const raw = getErrorMessage(error, "");
  const upper = raw.toUpperCase();
  if (upper.includes("INVALID")) {
    return "Incorrect or expired code. Request a new one.";
  }
  if (upper.includes("EXPIRED")) {
    return "Code expired. Request a new one.";
  }
  return raw.length > 0 ? raw : "Couldn't reset password. Try again.";
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { email?: string };
  const email = typeof search.email === "string" ? search.email : "";

  const resetPassword = useResetPasswordWithOtp();
  const sendVerificationOtp = useSendVerificationOtp();

  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const maskedEmail = useMemo(() => {
    if (!email.includes("@")) return email;
    const [local, domain] = email.split("@");
    if (local.length <= 2) return `${"*".repeat(local.length)}@${domain}`;
    return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
  }, [email]);

  if (!email) {
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
                  This reset link is incomplete
                </h1>
                <p className="text-sm text-balance text-muted-foreground">
                  We need your email to reset your password. Start the reset
                  over and we&rsquo;ll send a fresh code.
                </p>
              </div>
            </div>
            <Button asChild className="w-full">
              <Link to="/forgot-password">Start over</Link>
            </Button>
          </Card>
        </div>
      </>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedOtp = otp.trim();
    if (normalizedOtp.length !== 6) {
      setErrorMessage("Enter the 6-digit code sent to your email.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    try {
      const result = await resetPassword.mutateAsync({
        email,
        otp: normalizedOtp,
        password,
      });
      if (result.error) {
        setErrorMessage(mapResetErrorMessage(result.error));
        return;
      }
      navigate({ to: "/sign-in", search: { reset: "success" } });
    } catch (error) {
      setErrorMessage(mapResetErrorMessage(error));
    }
  };

  const handleResendCode = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await sendVerificationOtp.mutateAsync({
        email,
        type: "forget-password",
      });
      setSuccessMessage("A new code is on its way.");
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, "Couldn't resend code. Try again."),
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
                Set a new password
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                Enter the 6-digit code we sent to{" "}
                <span className="font-medium text-foreground">
                  {maskedEmail || "your email"}
                </span>{" "}
                and choose a new password.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">New password</Label>
                <PasswordInput
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <PasswordInput
                  id="confirmPassword"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
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
                disabled={resetPassword.isPending}
              >
                {resetPassword.isPending ? "Resetting…" : "Reset password"}
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
            Remembered your password?{" "}
            <Link
              to="/sign-in"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
