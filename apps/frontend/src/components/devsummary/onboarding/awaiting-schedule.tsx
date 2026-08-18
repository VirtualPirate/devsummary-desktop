import { CalendarClock } from "lucide-react";

/**
 * `/briefs` for a workspace member who cannot create a schedule: repositories
 * are read, but briefs are only produced on a schedule and only owners/admins
 * can create one (`brief-schedules.controller.ts` requires the admin role).
 *
 * Unreachable on a desktop install — the local user is seeded as owner of the
 * default workspace and owns every one they create — but the role check it
 * hangs off is still enforced backend-side, so the branch is kept rather than
 * deleted. The "who to ask" CTA is gone: there is no one else on this machine.
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
    </div>
  );
}
