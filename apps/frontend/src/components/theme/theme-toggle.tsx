import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";

type ThemeToggleProps = {
  className?: string;
};

// Matches the marketing site: one click flips, and the icon shows the theme
// you'd switch TO. "system" stays selectable from Settings > Theme.
const ICON =
  "absolute size-4 transition-all duration-200 motion-reduce:transition-none";

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative transition-transform active:scale-90 motion-reduce:transition-none",
        className,
      )}
      aria-label={`Switch to ${next} theme`}
      aria-pressed={resolvedTheme === "light"}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      <Sun className={cn(ICON, "-rotate-90 scale-0 dark:rotate-0 dark:scale-100")} />
      <Moon className={cn(ICON, "rotate-0 scale-100 dark:rotate-90 dark:scale-0")} />
    </Button>
  );
}
