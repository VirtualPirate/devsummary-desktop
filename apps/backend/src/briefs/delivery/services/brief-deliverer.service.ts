import { Injectable, Logger, Optional } from '@nestjs/common';
import type { BriefDeliveryChannel } from '@launchstack/api-interfaces';
import { BriefsRepository } from '../../generation/repositories/briefs.repository';
import { BriefSchedulesRepository } from '../../schedules/repositories/brief-schedules.repository';
import { BriefDesktopService } from './brief-desktop.service';

/**
 * Desktop notification is the only delivery channel. Slack was removed
 * deliberately (see the root AGENTS.md, "Deliberately not included"), and email
 * never shipped (D-H) — `BriefDeliveryChannel` still carries both names so old
 * rows in `delivered_channels` keep reading back.
 */
type ChannelResult = {
  kind: BriefDeliveryChannel;
  ok: boolean;
  err?: string;
};

@Injectable()
export class BriefDelivererService {
  private readonly logger = new Logger(BriefDelivererService.name);

  constructor(
    private readonly briefs: BriefsRepository,
    private readonly schedules: BriefSchedulesRepository,
    // Optional and last so the channel degrades to "absent" rather than taking
    // delivery down if it is ever unregistered.
    @Optional() private readonly desktop?: BriefDesktopService,
  ) {}

  async deliver(briefId: string): Promise<void> {
    const brief = await this.briefs.findById(briefId);
    if (!brief) return;
    const schedule = brief.briefScheduleId
      ? await this.schedules.findById(brief.briefScheduleId)
      : null;

    if (brief.briefScheduleId && !schedule) {
      // `findById` filters soft-deletes, so a schedule deleted mid-flight reads
      // as absent. Claiming `delivered` for that is the one outcome that must
      // not happen. Recording the reason without touching `status` is enough:
      // see the all-channels branch below for why `failed` is the wrong verdict.
      const failureReason = `[delivery] brief schedule ${brief.briefScheduleId} was deleted before delivery; nothing was sent`;
      await this.briefs.update(briefId, { failureReason });
      this.logger.warn(`Brief ${briefId} delivery failed: ${failureReason}`);
      return;
    }

    const renderable = {
      id: brief.id,
      title: brief.title,
      summary: brief.summary,
    };

    const tasks: Array<Promise<ChannelResult>> = [];

    const desktop = this.desktop;
    if (desktop && (await desktop.enabled())) {
      tasks.push(
        desktop
          .send(renderable)
          .then<ChannelResult>(() => ({ kind: 'desktop', ok: true }))
          .catch<ChannelResult>((e: unknown) => ({
            kind: 'desktop',
            ok: false,
            err: e instanceof Error ? e.message : String(e),
          })),
      );
    }

    const results = await Promise.all(tasks);
    if (results.length === 0) {
      // Dashboard-only brief: notifications are off, so there is nothing to
      // report as sent. Leave it in the `generated` state the generator set
      // instead of inventing a delivery.
      this.logger.log(
        `Brief ${briefId} has no delivery channels configured; nothing to send`,
      );
      return;
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failureReason =
      results
        .filter((r) => !r.ok)
        .map((r) => `[${r.kind}] ${r.err}`)
        .join('; ') || null;

    const now = new Date();

    if (succeeded > 0) {
      await this.briefs.update(briefId, {
        status: 'delivered',
        deliveredAt: now,
        failureReason,
        deliveredChannels: [
          ...new Set([
            ...brief.deliveredChannels,
            ...results.filter((r) => r.ok).map((r) => r.kind),
          ]),
        ],
      });
      if (brief.briefScheduleId) {
        await this.schedules.update(brief.briefScheduleId, { lastSentAt: now });
      }
    } else {
      // `status` stays whatever generation left it — `generated`. The brief was
      // written, its summary and commits are stored, and it is readable; only
      // the send failed. `failed` is a *generation* verdict everywhere
      // downstream, so writing it here made a finished brief render as "we
      // couldn't generate this brief", hid its summary, and offered a
      // regenerate that would re-spend the LLM to fix a notification failure.
      await this.briefs.update(briefId, { failureReason });
      this.logger.warn(`Brief ${briefId} delivery failed: ${failureReason}`);
    }
  }
}
