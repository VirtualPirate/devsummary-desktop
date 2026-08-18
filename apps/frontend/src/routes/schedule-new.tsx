import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { ScheduleWizard } from "@/components/devsummary/schedules/schedule-wizard";

export function ScheduleNewPage() {
  return (
    // Single-column form: the shell's max-w-6xl leaves the fields stretched.
    <div className="mx-auto max-w-3xl">
      <div className="mb-3">
        <Link
          to="/schedules"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to schedules
        </Link>
      </div>
      <PageHeader eyebrow="Schedule" title="New schedule" />
      <ScheduleWizard />
    </div>
  );
}
