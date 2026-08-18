import { Globe } from "lucide-react";

import { Button } from "@/components/ui/button";

interface GoogleAuthButtonProps {
  onClick: () => Promise<void> | void;
  isPending?: boolean;
  label?: string;
}

export function GoogleAuthButton({
  onClick,
  isPending = false,
  label = "Continue with Google",
}: GoogleAuthButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onClick}
      disabled={isPending}
    >
      <Globe className="size-4" />
      {isPending ? "Redirecting…" : label}
    </Button>
  );
}
