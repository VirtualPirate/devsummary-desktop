import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={isVisible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setIsVisible((value) => !value)}
        tabIndex={-1}
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
      >
        {isVisible ? (
          <EyeOff className="size-4" />
        ) : (
          <Eye className="size-4" />
        )}
      </button>
    </div>
  );
}
