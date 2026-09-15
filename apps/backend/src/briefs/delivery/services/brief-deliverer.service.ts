import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppError } from '../../../common/errors';
import type {
  BriefDeliveryChannel,
  BriefReportResponse,
} from '@launchstack/api-interfaces';
import { BriefsRepository } from '../../generation/repositories/briefs.repository';
import { BriefReportService } from '../../generation/services/brief-report.service';
import { BriefSchedulesRepository } from '../../schedules/repositories/brief-schedules.repository';
import { BriefDesktopService } from './brief-desktop.service';
import { BriefSlackService } from './brief-slack.service';

/**
 * Both channels are stored: a successful `desktop` send joins
 * `delivered_channels` like Slack does. Only the *manual re-send* is narrower —
 * `deliverOne` takes `'slack'` alone, because re-notifying the machine you are
 * already looking at is not a retry. (`BriefDeliveryChannel` still carries
 * `'email'` for rows written before docs/DELTAS.md D-H removed that channel.)
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
    private readonly slack: BriefSlackService,
    private readonly report: BriefReportService,
    // Optional and last so the channel degrades to "absent" rather than taking
    // delivery down if it is ever unregistered.
    @Optional() private readonly desktop?: BriefDesktopService,
  ) {}

  /**
   * The figures are a nicety; the brief is not. `build` re-queries live commit
   * data across five statements, so a scope that broke since generation must
   * degrade to a summary-only delivery rather than turn into a failure that
   * marks the whole brief `failed`.
   */
  private async loadReport(
    organizationId: string,
    briefId: string,
  ): Promise<BriefReportResponse | null> {
    try {
      return await this.report.build(organizationId, briefId);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Brief ${briefId} report unavailable, delivering summary only: ${reason}`,
      );
      return null;
    }
  }

  async deliver(briefId: string): Promise<void> {
    const brief = await this.briefs.findById(briefId);
    if (!brief) return;
    const schedule = brief.briefScheduleId
      ? await this.schedules.findById(brief.briefScheduleId)
      : null;

    if (brief.briefScheduleId && !schedule) {
      // `findById` filters soft-deletes, so a schedule deleted mid-flight reads
      // as absent — and a scheduled brief never carries its own recipients, so
      // the fallbacks below would silently attempt nothing. Claiming
      // `delivered` for that is the one outcome that must not happen. Recording
      // the reason without touching `status` is enough: see the all-channels
      // branch below for why `failed` is the wrong verdict here.
      const failureReason = `[delivery] brief schedule ${brief.briefScheduleId} was deleted before delivery; nothing was sent`;
      await this.briefs.update(briefId, { failureReason });
      this.logger.warn(`Brief ${briefId} delivery failed: ${failureReason}`);
      return;
    }

    const slackChannel =
      schedule?.slackChannelId ?? brief.deliverySlackChannelId;

    const renderable = {
      id: brief.id,
      title: brief.title,
      briefInfoTitle: brief.briefInfoTitle,
      summary: brief.summary,
      highlights: brief.highlights,
    };

    const report = slackChannel
      ? await this.loadReport(brief.organizationId, brief.id)
      : null;

    const tasks: Array<Promise<ChannelResult>> = [];
    if (slackChannel) {
      tasks.push(
        this.slack
          .post(brief.organizationId, renderable, slackChannel, report)
          .then<ChannelResult>(() => ({ kind: 'slack', ok: true }))
          .catch<ChannelResult>((e: unknown) => ({
            kind: 'slack',
            ok: false,
            err: e instanceof Error ? e.message : String(e),
          })),
      );
    }

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
      // Dashboard-only brief: no channel was ever configured, so there is
      // nothing to report as sent. Leave it in the `generated` state the
      // generator set instead of inventing a delivery.
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
        deliveredChannels: union(
          brief.deliveredChannels,
          results.filter((r) => r.ok).map((r) => r.kind),
        ),
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
      // regenerate that would re-spend the LLM to fix a Slack outage.
      // `failureReason` is the whole record of the failure; re-delivery is the
      // per-channel manual path (`deliverOne`).
      await this.briefs.update(briefId, { failureReason });
      this.logger.warn(`Brief ${briefId} delivery failed: ${failureReason}`);
    }
  }

  /**
   * Re-send to Slack on demand, from the brief detail view. The scheduled path
   * fires exactly once per brief, so a Slack post that died on
   * `not_in_channel` — or a channel added to the schedule after the fact —
   * otherwise has no way out: nothing re-delivers an existing row.
   *
   * Throws rather than writing `failed`, unlike `deliver`: the caller is a
   * human watching a button, so the upstream reason belongs in the response,
   * and downgrading an already-delivered brief because a manual retry missed
   * would erase the record of what did go out.
   */
  async deliverOne(briefId: string, channel: 'slack'): Promise<void> {
    const brief = await this.briefs.findById(briefId);
    if (!brief) throw AppError.BRIEF_NOT_FOUND();
    if (!brief.generatedAt) throw AppError.BRIEF_NOT_DELIVERABLE();

    const schedule = brief.briefScheduleId
      ? await this.schedules.findById(brief.briefScheduleId)
      : null;
    const slackChannel =
      schedule?.slackChannelId ?? brief.deliverySlackChannelId;

    if (!slackChannel) {
      throw AppError.BRIEF_DELIVERY_CHANNEL_NOT_CONFIGURED({ channel });
    }

    const renderable = {
      id: brief.id,
      title: brief.title,
      briefInfoTitle: brief.briefInfoTitle,
      summary: brief.summary,
      highlights: brief.highlights,
    };

    const report = await this.loadReport(brief.organizationId, brief.id);

    try {
      await this.slack.post(
        brief.organizationId,
        renderable,
        slackChannel,
        report,
      );
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Brief ${briefId} manual ${channel} delivery failed: ${reason}`,
      );
      throw AppError.BRIEF_DELIVERY_FAILED({ channel, reason });
    }

    const now = new Date();
    await this.briefs.update(briefId, {
      status: 'delivered',
      deliveredAt: now,
      // Only this channel's segment clears. Wiping the whole string would hide
      // the other channel's still-live failure behind a partial success.
      failureReason: dropChannelFailure(brief.failureReason, channel),
      // Only this channel joins the list — `status` is a whole-brief verdict
      // and cannot record which channel actually went out.
      deliveredChannels: union(brief.deliveredChannels, [channel]),
    });
    if (brief.briefScheduleId) {
      await this.schedules.update(brief.briefScheduleId, { lastSentAt: now });
    }
    this.logger.log(`Brief ${briefId} manually delivered via ${channel}`);
  }
}

function union(
  existing: BriefDeliveryChannel[],
  added: BriefDeliveryChannel[],
): BriefDeliveryChannel[] {
  return [...new Set([...existing, ...added])];
}

/** `failureReason` is `[slack] …; [desktop] …` — see `deliver` above. */
function dropChannelFailure(
  reason: string | null,
  channel: BriefDeliveryChannel,
): string | null {
  if (!reason) return null;
  const kept = reason
    .split('; ')
    .filter((part) => !part.startsWith(`[${channel}]`));
  return kept.length > 0 ? kept.join('; ') : null;
}
