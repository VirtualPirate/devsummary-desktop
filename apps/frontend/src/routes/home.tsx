import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { ActivitySection } from "@/components/devsummary/home/activity-section";
import { NextStepBar } from "@/components/devsummary/onboarding/next-step-bar";
import { useConnectReposGate } from "@/hooks/use-connect-repos-gate";
import { useNextStep } from "@/hooks/use-next-step";
import { useAuthSession } from "@/hooks/api/use-auth";

export function HomePage() {
  const sessionQuery = useAuthSession();
  const gate = useConnectReposGate();
  // Guidance sits above the charts rather than replacing them: `gate` takes the
  // page over only when there is genuinely nothing to plot (nothing connected,
  // or no branch chosen anywhere), while `nextStep` is one row that explains why
  // no brief has arrived and leaves the dashboard readable.
  const nextStep = useNextStep();

  const userName = sessionQuery.data?.data?.user.name ?? "there";

  if (gate) return gate;

  return (
    <>
      <PageHeader
        title={`Hi, ${userName}`}
        description="A quick read on how your team's work is trending."
        actions={
          <Button asChild size="sm">
            <Link to="/schedules/new">
              <Plus className="size-3.5" /> New schedule
            </Link>
          </Button>
        }
      />

      {nextStep ? <NextStepBar step={nextStep} /> : null}

      <ActivitySection />
    </>
  );
}
