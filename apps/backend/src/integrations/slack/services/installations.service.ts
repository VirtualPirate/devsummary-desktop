import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SlackInstallation } from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import {
  KYSELY_DB,
  type AppDatabase,
  type SlackInstallationRaw,
  type SlackInstallationSelect,
} from '../../../databases/kysely';
import { BriefSchedulesRepository } from '../../../briefs/schedules/repositories/brief-schedules.repository';
import { SlackClient } from '../slack.client';
import type { SlackConfig } from '../slack.config';
import { SlackInstallationsRepository } from '../repositories/installations.repository';
import { StateTokenService } from './state-token.service';

/** Wire shape lives in the shared package — the frontend gates its Slack
 * delivery field on this list, so the two must not drift. */
export type SlackInstallationView = SlackInstallation;

function serialize(row: SlackInstallationSelect): SlackInstallationView {
  const raw = row.raw;
  return {
    id: row.id,
    teamId: raw.teamId,
    teamName: raw.teamName,
    botUserId: raw.botUserId,
    appId: raw.appId,
    scope: raw.scope,
    authedUserId: raw.authedUserId ?? null,
    connectedByUserId: raw.connectedByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

interface OauthAccessResponseShape {
  access_token?: string;
  team?: { id?: string; name?: string };
  bot_user_id?: string;
  app_id?: string;
  scope?: string;
  authed_user?: { id?: string };
}

function buildRaw(
  oauth: OauthAccessResponseShape,
  connectedByUserId: string | null,
): { accessToken: string; raw: SlackInstallationRaw } {
  if (
    !oauth.access_token ||
    !oauth.team?.id ||
    !oauth.team?.name ||
    !oauth.bot_user_id ||
    !oauth.app_id ||
    !oauth.scope
  ) {
    throw AppError.SLACK_OAUTH_EXCHANGE_FAILED({
      reason: 'OAuth response missing required fields',
    });
  }
  return {
    accessToken: oauth.access_token,
    raw: {
      teamId: oauth.team.id,
      teamName: oauth.team.name,
      botUserId: oauth.bot_user_id,
      appId: oauth.app_id,
      scope: oauth.scope,
      authedUserId: oauth.authed_user?.id,
      connectedByUserId: connectedByUserId ?? undefined,
      oauthResponse: oauth,
    },
  };
}

@Injectable()
export class SlackInstallationsService {
  private readonly logger = new Logger(SlackInstallationsService.name);

  constructor(
    private readonly installs: SlackInstallationsRepository,
    private readonly stateToken: StateTokenService,
    private readonly client: SlackClient,
    private readonly config: SlackConfig | null,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly briefSchedules: BriefSchedulesRepository,
  ) {}

  private requireConfig(): SlackConfig {
    if (!this.config) {
      throw AppError.SLACK_NOT_CONFIGURED();
    }
    return this.config;
  }

  buildInstallUrl(input: { orgId: string; userId: string }): string {
    this.requireConfig();
    const state = this.stateToken.sign(input);
    return this.client.generateAuthUri(state);
  }

  async handleCallback(input: {
    state: string | undefined;
    code: string | undefined;
    sessionUserId: string | null;
  }): Promise<{ orgId: string }> {
    this.requireConfig();

    if (!input.state || !input.code) {
      throw AppError.SLACK_STATE_INVALID();
    }

    let payload: { orgId: string; userId: string };
    try {
      payload = this.stateToken.verify(input.state);
    } catch {
      throw AppError.SLACK_STATE_INVALID();
    }

    if (input.sessionUserId && payload.userId !== input.sessionUserId) {
      throw AppError.SLACK_STATE_USER_MISMATCH();
    }

    const oauth = (await this.client.exchangeCodeForToken(
      input.code,
    )) as OauthAccessResponseShape;
    const built = buildRaw(oauth, payload.userId);

    await this.db.transaction().execute(async (tx) => {
      const existing = await this.installs.findByOrganizationIdIncludingDeleted(
        payload.orgId,
        tx,
      );

      if (existing && existing.deletedAt === null) {
        throw AppError.SLACK_ORG_ALREADY_CONNECTED();
      }

      if (existing) {
        await this.installs.updateTokenAndRaw(
          existing.id,
          {
            accessToken: built.accessToken,
            teamId: built.raw.teamId,
            raw: built.raw,
          },
          tx,
        );
        this.logger.log(
          `Slack re-installed for org=${payload.orgId} team=${built.raw.teamId}`,
        );
        return;
      }

      await this.installs.create(
        {
          organizationId: payload.orgId,
          accessToken: built.accessToken,
          teamId: built.raw.teamId,
          raw: built.raw,
        },
        tx,
      );
      this.logger.log(
        `Slack installed for org=${payload.orgId} team=${built.raw.teamId}`,
      );
    });

    return { orgId: payload.orgId };
  }

  async listForOrg(orgId: string): Promise<SlackInstallationView[]> {
    const row = await this.installs.findActiveByOrganizationId(orgId);
    return row ? [serialize(row)] : [];
  }

  async disconnect(orgId: string, installationId: string): Promise<void> {
    const row = await this.installs.findByIdScopedToOrg(installationId, orgId);
    if (!row) {
      throw AppError.SLACK_INSTALLATION_NOT_FOUND();
    }

    // The same Slack workspace may be connected to several organizations, and
    // `auth.revoke` kills the bot token for all of them — so only revoke when
    // this row is the last active holder of the workspace. A null teamId (row
    // predating the team_id backfill, or an OAuth response without a team) is
    // treated as shared: leaving a token alive until the app is uninstalled in
    // Slack is recoverable, killing another org's delivery is not.
    let skipRevokeReason: string | null = null;
    if (row.teamId === null) {
      skipRevokeReason = 'team_id unknown';
    } else if (
      await this.installs.existsOtherActiveByTeamId(row.teamId, row.id)
    ) {
      skipRevokeReason = 'workspace still connected to another organization';
    }

    if (skipRevokeReason) {
      this.logger.log(
        `Slack token revoke skipped for org=${orgId} installation=${installationId} team=${
          row.teamId ?? 'unknown'
        }: ${skipRevokeReason}`,
      );
    } else {
      try {
        await this.client.revokeToken(row.accessToken);
      } catch (err) {
        this.logger.warn(
          `Slack token revoke failed for org=${orgId}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    // The installation row is only soft-deleted, so the FK's ON DELETE SET NULL
    // never fires and every brief schedule keeps pointing at a dead install.
    // Delivery re-resolves the org's active installation by itself, so a stale
    // pair means every future brief fails forever — and once a *different*
    // workspace is connected, the old channel id would be posted against the
    // new token. Both columns go together (brief_schedules_slack_pair).
    await this.db.transaction().execute(async (tx) => {
      await this.installs.softDelete(installationId, tx);
      await this.briefSchedules.clearSlackConfigForInstallation(
        installationId,
        tx,
      );
    });
    this.logger.log(
      `Slack disconnected for org=${orgId} installation=${installationId}`,
    );
  }
}
