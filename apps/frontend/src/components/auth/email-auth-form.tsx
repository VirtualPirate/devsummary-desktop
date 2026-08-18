import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";

type EmailAuthMode = "sign-in" | "sign-up";

type EmailAuthSubmitValues = {
  name?: string;
  email: string;
  password: string;
};

interface EmailAuthFormProps {
  mode: EmailAuthMode;
  isPending?: boolean;
  errorMessage?: string | null;
  initialEmail?: string;
  onSubmit: (values: EmailAuthSubmitValues) => Promise<void> | void;
}

export function EmailAuthForm({
  mode,
  isPending = false,
  errorMessage,
  initialEmail = "",
  onSubmit,
}: EmailAuthFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");

  const submitLabel = useMemo(() => {
    return mode === "sign-up" ? "Create account" : "Sign in";
  }, [mode]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await onSubmit({
      name: mode === "sign-up" ? name : undefined,
      email,
      password,
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {mode === "sign-up" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Jane Doe"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </div>
      ) : null}

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

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="password">Password</Label>
          {mode === "sign-in" ? (
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-brand underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          ) : null}
        </div>
        <PasswordInput
          id="password"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={
            mode === "sign-up" ? "new-password" : "current-password"
          }
          required
        />
      </div>

      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
