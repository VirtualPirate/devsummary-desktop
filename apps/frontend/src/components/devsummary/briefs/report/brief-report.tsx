import type { ReactNode } from "react";
import type {
  BriefReportResponse,
  BriefResponse,
} from "@launchstack/api-interfaces";
import { WORK_CATEGORY_CSS_VAR } from "@/components/devsummary/shared/commit-type-colors";
import { splitSummary } from "../brief-insights";
import { ActivityChart } from "./activity-chart";
import { ChartTooltipProvider } from "./chart-tooltip";
import { ChurnChart } from "./churn-chart";
import { FactsRail } from "./facts-rail";
import { Highlights } from "./highlights";
import { RankedBars } from "./ranked-bars";

/**
 * Two columns: a rail that keeps every number on screen, and a story column
 * that scrolls. Under 940px of *available* width the rail becomes a block at
 * the top instead.
 */
export function BriefReport({
  brief,
  report,
  storyColumn,
  isWorking,
}: {
  brief: BriefResponse;
  report: BriefReportResponse | undefined;
  /** The narrative — prose or skeleton, decided by the caller. */
  storyColumn: ReactNode;
  isWorking: boolean;
}) {
  const showChurn =
    !!report &&
    !report.scopeDeleted &&
    report.daily.length > 1 &&
    report.totals.linesAdded + report.totals.linesRemoved > 0;

  // A single-bucket period says nothing the KPI rows do not already say, and
  // ActivityChart itself renders nothing at zero commits — guard here too so
  // the section heading never appears above an empty chart.
  const showActivity =
    !!report &&
    !report.scopeDeleted &&
    report.daily.length > 1 &&
    report.totals.commits > 0;

  return (
    <ChartTooltipProvider>
      {/*
        Container query, not `lg:`. This renders both full-page and inside a
        672px dialog; a viewport breakpoint would give the dialog two columns
        on any desktop screen and squeeze the story to ~310px. 940px is the
        threshold the design template uses.
      */}
      <div className="@container">
        <div className="grid items-start gap-8 @min-[940px]:grid-cols-[330px_minmax(0,1fr)]">
          <FactsRail brief={brief} report={report} isWorking={isWorking} />

          <div className="min-w-0">
            {storyColumn}

            {/*
              Directly under the title and summary, above every chart: the
              highlights are the ranked answer to "what happened", and a reader
              who stops after two sections should have hit them. Charts are
              context for that answer, so they follow it.
            */}
            {!isWorking ? (
              <Highlights
                highlights={brief.highlights}
                commitCount={brief.commitCount}
              />
            ) : null}

            {showActivity ? (
              <section className="border-b py-8">
                <div className="flex items-baseline justify-between gap-4">
                  <h4 className="text-[15px] font-semibold tracking-tight">
                    Activity
                  </h4>
                  <p className="text-[12.5px] text-muted-foreground">
                    commits per day
                  </p>
                </div>
                <div className="mt-4">
                  <ActivityChart daily={report.daily} height={168} />
                </div>
              </section>
            ) : null}

            {showChurn ? (
              <section className="border-b py-8">
                <div className="flex items-baseline justify-between gap-4">
                  <h4 className="text-[15px] font-semibold tracking-tight">
                    Code added vs removed
                  </h4>
                  <p className="text-[12.5px] text-muted-foreground">
                    lines per day
                  </p>
                </div>
                <div className="mt-4">
                  <ChurnChart
                    daily={report.daily}
                    totals={report.totals}
                    locCoverage={report.locCoverage}
                  />
                </div>
              </section>
            ) : null}

            {report && report.repositories.length > 0 ? (
              <section className="py-8">
                <div className="flex items-baseline justify-between gap-4">
                  <h4 className="text-[15px] font-semibold tracking-tight">
                    Where it happened
                  </h4>
                  <p className="text-[12.5px] text-muted-foreground">
                    {report.totals.repositoriesTouched} of{" "}
                    {report.totals.repositoriesInScope} repositories
                  </p>
                </div>
                <div className="mt-4">
                  <RankedBars
                    rows={report.repositories.map((r) => ({
                      key: r.repositoryId,
                      label: r.fullName,
                      value: r.commits,
                      colour: WORK_CATEGORY_CSS_VAR.feature,
                      tooltip: [
                        r.fullName,
                        `${r.commits} commits · +${r.linesAdded.toLocaleString()} / −${r.linesRemoved.toLocaleString()}`,
                      ],
                    }))}
                  />
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </ChartTooltipProvider>
  );
}

/** The narrative block — the default story column for a finished brief. */
export function BriefStory({ brief }: { brief: BriefResponse }) {
  const { lead, body } = splitSummary(brief.summary);
  const hasBody = body.length > 0;
  const proseText = hasBody ? body : (brief.summary?.trim() ?? "");

  return (
    <>
      <h1 className="text-[25px] font-semibold leading-tight tracking-tight text-balance sm:text-[32px]">
        {brief.title || "(untitled)"}
      </h1>
      {hasBody ? (
        <p className="mt-3.5 max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
          {lead}
        </p>
      ) : null}
      <section className="border-b py-8">
        <div className="max-w-[70ch] whitespace-pre-wrap text-[16.5px] leading-[1.65] text-foreground/90">
          {proseText || "(no summary)"}
        </div>
      </section>
    </>
  );
}
