import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * `/briefs` for a viewer with no schedule: repositories are read, but briefs are
 * only produced on a schedule and only owners/admins can create one
 * (`brief-schedules.controller.ts` requires the admin role).
 *
 * No ingest matrix and no primary action — none of it is something this user can
 * act on. An admin is told what to do next; a viewer is told what the state is
 * and who owns it. Safe to own the page here because there is no list to hide;
 * on `/` a viewer gets the compact bar instead, so their dashboard stays intact.
 */
export function AwaitingSchedule({ orgName }: { orgName?: string }) {
  return (
    <div className="mx-auto max-w-[560px] px-7 py-16 text-center">
      <div className="mx-auto mb-4 grid size-13 place-items-center rounded-2xl border bg-card shadow-e1">
        <CalendarClock className="size-[22px] text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        No briefs are scheduled yet
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        Your repositories are connected and read. Briefs get written on a
        schedule, and only owners or admins
        {orgName ? (
          <>
            {" "}
            of <b>{orgName}</b>
          </>
        ) : null}{" "}
        can set one up — once they do, briefs land here.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link to="/settings/organization/members">See who to ask</Link>
        </Button>
      </div>
    </div>
  );
}
