import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCommitsProcessing } from "@/hooks/use-commits-processing";

export const SCHEDULE_BLOCKED_REASON =
  "Commits are still being fetched and analyzed. You can create a schedule once that finishes.";

/**
 * The single entry point to `/schedules/new`, so every surface offering it
 * disables in step with the create endpoint's own gate (409 while commits are
 * being processed) instead of each call site repeating the rule.
 *
 * `asChild` is dropped when blocked: a disabled `<Button>` rendering a `<Link>`
 * still navigates, because the anchor keeps handling the click. The `<span>`
 * wrapper is what carries the tooltip — a disabled button fires no mouse events,
 * so `title` on the button itself never shows.
 *
 * The onboarding surfaces (`setup-console.tsx`, `next-step-bar.tsx`) hold their
 * own copy of this lock, because there the wait is the whole message rather than
 * a greyed-out button, and they explain why.
 */
export function NewScheduleButton({
  children = (
    <>
      <Plus className="size-3.5" /> New schedule
    </>
  ),
  size = "sm",
}: {
  children?: ReactNode;
  size?: ComponentProps<typeof Button>["size"];
}) {
  const blocked = useCommitsProcessing();

  if (blocked) {
    return (
      <span title={SCHEDULE_BLOCKED_REASON} className="inline-flex">
        <Button size={size} disabled>
          {children}
        </Button>
      </span>
    );
  }

  return (
    <Button asChild size={size}>
      <Link to="/schedules/new">{children}</Link>
    </Button>
  );
}
