import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JOB, JobHandlerRegistry, JobQueueService } from '../../../jobs';
import { BriefActivities } from './brief.activities';

export interface GenerateBriefInput {
  briefId: string;
  deliver?: boolean;
  organizationId?: string;
}

export interface BackfillBriefsInput {
  scheduleId: string;
  organizationId?: string;
  /** Months of history to fill. Omitted falls back to the config window. */
  backfillMonths?: number;
}

/**
 * `DispatchDueBriefsWorkflow`, `GenerateBriefWorkflow` and
 * `BackfillBriefsWorkflow`, as plain handlers.
 *
 * The two fan-out workflows started children with `ParentClosePolicy.ABANDON`;
 * an enqueue is already abandoned by construction — the row outlives its
 * parent. Their child id is `brief:<briefId>` rather than a generated one, so a
 * re-dispatched stale-pending brief rejoins the run it already has instead of
 * generating twice.
 */
@Injectable()
export class BriefJobs implements OnModuleInit {
  constructor(
    private readonly activities: BriefActivities,
    private readonly queue: JobQueueService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.dispatchDueBriefs, () => this.dispatchDue());
    this.registry.register(JOB.generateBrief, (args) =>
      this.generate(args as unknown as GenerateBriefInput),
    );
    this.registry.register(JOB.backfillBriefs, (args) =>
      this.backfill(args as unknown as BackfillBriefsInput),
    );
  }

  async dispatchDue(): Promise<void> {
    const { briefs } = await this.activities.claimDue();
    for (const b of briefs) {
      await this.enqueueGenerate(b.briefId, b.organizationId, b.deliver);
    }
  }

  async generate(input: GenerateBriefInput): Promise<void> {
    const { proceed, alreadyGenerated } = await this.activities.markGenerating({
      briefId: input.briefId,
    });
    if (!proceed) return;
    // Already generated means this is a requeue of a run that died between the
    // generator and the send — pick up at `deliver` rather than re-spending the
    // LLM call on content that is already written.
    if (!alreadyGenerated) {
      const { terminal } = await this.activities.generateContent({
        briefId: input.briefId,
      });
      if (terminal) return;
    }
    if (input.deliver === false) return;
    await this.activities.deliver({ briefId: input.briefId });
  }

  async backfill(input: BackfillBriefsInput): Promise<void> {
    const { briefs } = await this.activities.planBackfill({
      scheduleId: input.scheduleId,
      backfillMonths: input.backfillMonths,
    });
    for (const b of briefs) {
      // deliver: false — a backfilled historical period is generated for the
      // dashboard, never sent.
      await this.enqueueGenerate(b.briefId, b.organizationId, false);
    }
  }

  private async enqueueGenerate(
    briefId: string,
    organizationId: string,
    deliver: boolean,
  ): Promise<void> {
    await this.queue.enqueue(
      JOB.generateBrief,
      { briefId, deliver, organizationId },
      { id: `brief:${briefId}`, phase: 'generating', organizationId },
    );
  }
}
