import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AuthThemeToggle } from "@/components/theme/auth-theme-toggle";
import { BrandMark } from "@/components/devsummary/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForgetPassword } from "@/hooks/api/use-auth";

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

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const forgetPassword = useForgetPassword();
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    try {
      const result = await forgetPassword.mutateAsync({
        email: normalizedEmail,
      });
      if (result.error) {
        setErrorMessage(
          getErrorMessage(
            result.error,
            "Couldn't send reset code. Try again.",
          ),
        );
        return;
      }
      navigate({
        to: "/reset-password",
        search: { email: normalizedEmail },
      });
    } catch (error) {
      setErrorMessage(
        getErrorMessage(error, "Couldn't send reset code. Try again."),
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
                Forgot your password?
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                Enter your account email and we&rsquo;ll send a code to reset
                it.
              </p>
            </div>
          </div>

          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={forgetPassword.isPending}
            >
              {forgetPassword.isPending ? "Sending…" : "Send reset code"}
            </Button>
          </form>

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
