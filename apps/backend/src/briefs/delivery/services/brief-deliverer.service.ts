import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppError } from '../../../common/errors';
import type {
  BriefDeliveryChannel,
  BriefReportResponse,
} from '@launchstack/api-interfaces';
import type { BriefSelect } from '../../../databases/kysely';
import { BriefsRepository } from '../../generation/repositories/briefs.repository';
import { BriefReportService } from '../../generation/services/brief-report.service';
import { BriefSchedulesRepository } from '../../schedules/repositories/brief-schedules.repository';
import {
  BriefScopeResolver,
  type BriefScope,
} from '../../generation/services/brief-scope.resolver';
import { BriefDesktopService } from './brief-desktop.service';
import { BriefEmailService } from './brief-email.service';
import { BriefSlackService } from './brief-slack.service';

/**
 * All three channels are stored: a successful `desktop` send joins
 * `delivered_channels` like the other two, and `BriefDeliveryChannel` is
 * `'email' | 'slack' | 'desktop'` in the DTO and the database types alike.
 * Only the *manual re-send* is narrower — `deliverOne` excludes `desktop`,
 * because re-notifying the machine you are already looking at is not a retry.
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
    private readonly email: BriefEmailService,
    private readonly slack: BriefSlackService,
    private readonly report: BriefReportService,
    private readonly scopes: BriefScopeResolver,
    // Optional and last so the channel degrades to "absent" rather than taking
    // delivery down if it is ever unregistered.
    @Optional() private readonly desktop?: BriefDesktopService,
  ) {}

  /**
   * Only the scope's *name*, for the subject line. Resolution throws when the
   * project/team/collaborator/repo was deleted after generation, and a subject
   * is never worth failing a delivery over — the caller falls back to naming
   * the cadence.
   */
  private async loadScopeName(
    brief: BriefSelect,
  ): Promise<{ type: BriefSelect['scopeType']; name: string } | null> {
    const scope = toBriefScope(brief);
    if (!scope) return null;
    try {
      const resolved = await this.scopes.resolve({
        organizationId: brief.organizationId,
        scope,
      });
      return { type: brief.scopeType, name: resolved.scopeName };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Brief ${brief.id} scope unresolvable for subject line: ${reason}`,
      );
      return null;
    }
  }

  /**
   * The figures are a nicety; the brief is not. `build` re-queries live commit
   * data across five statements, so a scope that broke since generation must
   * degrade to a summary-only delivery rather than turn into a failure that
   * marks the whole brief `failed`. Loaded once here, not per channel: email
   * and Slack render the same numbers.
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
      // `delivered` for that is the one outcome that must not happen.
      const failureReason = `[delivery] brief schedule ${brief.briefScheduleId} was deleted before delivery; nothing was sent`;
      await this.briefs.update(briefId, { status: 'failed', failureReason });
      this.logger.warn(`Brief ${briefId} delivery failed: ${failureReason}`);
      return;
    }

    const emails = schedule?.emailRecipients ?? brief.deliveryEmails;
    const slackChannel =
      schedule?.slackChannelId ?? brief.deliverySlackChannelId;

    const renderable = {
      id: brief.id,
      title: brief.title,
      briefInfoTitle: brief.briefInfoTitle,
      summary: brief.summary,
      highlights: brief.highlights,
      scope: await this.loadScopeName(brief),
      cadence: schedule?.cadenceType ?? null,
    };

    const report =
      emails.length > 0 || slackChannel
        ? await this.loadReport(brief.organizationId, brief.id)
        : null;

    const tasks: Array<Promise<ChannelResult>> = [];
    if (emails.length > 0) {
      tasks.push(
        this.email
          .send(renderable, emails, report)
          .then<ChannelResult>(() => ({ kind: 'email', ok: true }))
          .catch<ChannelResult>((e: unknown) => ({
            kind: 'email',
            ok: false,
            err: e instanceof Error ? e.message : String(e),
          })),
      );
    }
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
      await this.briefs.update(briefId, {
        status: 'failed',
        failureReason,
      });
      this.logger.warn(`Brief ${briefId} delivery failed: ${failureReason}`);
    }
  }

  /**
   * Send one channel on demand, from the brief detail view. The scheduled path
   * fires exactly once per brief, so a Slack post that died on
   * `not_in_channel` — or an email list corrected after the fact — otherwise
   * has no way out: nothing re-delivers an existing row.
   *
   * Throws rather than writing `failed`, unlike `deliver`: the caller is a
   * human watching a button, so the upstream reason belongs in the response,
   * and downgrading an already-delivered brief because a manual retry of the
   * *other* channel missed would erase the record of what did go out.
   */
  async deliverOne(
    briefId: string,
    channel: Exclude<BriefDeliveryChannel, 'desktop'>,
  ): Promise<void> {
    const brief = await this.briefs.findById(briefId);
    if (!brief) throw AppError.BRIEF_NOT_FOUND();
    if (!brief.generatedAt) throw AppError.BRIEF_NOT_DELIVERABLE();

    const schedule = brief.briefScheduleId
      ? await this.schedules.findById(brief.briefScheduleId)
      : null;
    const emails = schedule?.emailRecipients ?? brief.deliveryEmails;
    const slackChannel =
      schedule?.slackChannelId ?? brief.deliverySlackChannelId;

    if (channel === 'email' && emails.length === 0) {
      throw AppError.BRIEF_DELIVERY_CHANNEL_NOT_CONFIGURED({ channel });
    }
    if (channel === 'slack' && !slackChannel) {
      throw AppError.BRIEF_DELIVERY_CHANNEL_NOT_CONFIGURED({ channel });
    }

    const renderable = {
      id: brief.id,
      title: brief.title,
      briefInfoTitle: brief.briefInfoTitle,
      summary: brief.summary,
      highlights: brief.highlights,
      scope: await this.loadScopeName(brief),
      cadence: schedule?.cadenceType ?? null,
    };

    const report = await this.loadReport(brief.organizationId, brief.id);

    try {
      if (channel === 'email') {
        await this.email.send(renderable, emails, report);
      } else {
        await this.slack.post(
          brief.organizationId,
          renderable,
          slackChannel!,
          report,
        );
      }
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
      // Only this channel joins the list. `status` cannot carry the other one:
      // it is a whole-brief verdict, so a manual Slack post used to mark the
      // brief delivered and hide the email button with no email ever sent.
      deliveredChannels: union(brief.deliveredChannels, [channel]),
    });
    if (brief.briefScheduleId) {
      await this.schedules.update(brief.briefScheduleId, { lastSentAt: now });
    }
    this.logger.log(`Brief ${briefId} manually delivered via ${channel}`);
  }
}

/** The brief's flat `scope_*` columns back into the resolver's tagged union. */
function toBriefScope(brief: BriefSelect): BriefScope | null {
  switch (brief.scopeType) {
    case 'project':
      return brief.scopeProjectId
        ? { type: 'project', projectId: brief.scopeProjectId }
        : null;
    case 'team':
      return brief.scopeTeamId
        ? { type: 'team', teamId: brief.scopeTeamId }
        : null;
    case 'collaborator':
      return brief.scopeCollaboratorId
        ? { type: 'collaborator', collaboratorId: brief.scopeCollaboratorId }
        : null;
    case 'repository':
      return brief.scopeRepositoryId
        ? {
            type: 'repository',
            repositoryId: brief.scopeRepositoryId,
            branch: brief.scopeBranch ?? undefined,
          }
        : null;
    default:
      return null;
  }
}

function union(
  existing: BriefDeliveryChannel[],
  added: BriefDeliveryChannel[],
): BriefDeliveryChannel[] {
  return [...new Set([...existing, ...added])];
}

/** `failureReason` is `[email] …; [slack] …` — see `deliver` above. */
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
