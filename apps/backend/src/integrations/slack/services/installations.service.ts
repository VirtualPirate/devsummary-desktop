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
import { SecretsService } from '../../../local/settings/secrets.service';
import { SlackClient } from '../slack.client';
import { SlackInstallationsRepository } from '../repositories/installations.repository';

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

@Injectable()
export class SlackInstallationsService {
  private readonly logger = new Logger(SlackInstallationsService.name);

  constructor(
    private readonly installs: SlackInstallationsRepository,
    private readonly client: SlackClient,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly briefSchedules: BriefSchedulesRepository,
    private readonly secrets: SecretsService,
  ) {}

  /**
   * Paste-a-token replacement for the OAuth callback. `auth.test` is the whole
   * validation: a token that cannot identify itself cannot post either, and
   * failing here is the difference between a red field in settings and a brief
   * that fails silently a week later.
   *
   * Unlike the OAuth flow this is *idempotent* — re-pasting a token for an
   * already-connected workspace replaces it instead of throwing
   * `SLACK_ORG_ALREADY_CONNECTED`, because rotating a bot token is the normal
   * reason to come back to this screen.
   */
  async connectToken(input: {
    orgId: string;
    token: string;
    userId: string | null;
  }): Promise<SlackInstallationView> {
    const auth = await this.client.authTest(input.token);

    const teamId = auth.team_id;
    if (!teamId) {
      throw AppError.SLACK_API_FAILED({
        reason: 'auth.test returned no team_id',
      });
    }

    const raw: SlackInstallationRaw = {
      teamId,
      teamName: auth.team ?? teamId,
      botUserId: auth.user_id ?? '',
      // `auth.test` does not carry the app id, and nothing downstream reads it —
      // it was OAuth provenance. Left blank rather than faking one from `bot_id`.
      appId: '',
      scope: (auth.response_metadata?.scopes ?? []).join(','),
      connectedByUserId: input.userId ?? undefined,
      oauthResponse: auth,
    };

    const row = await this.db.transaction().execute(async (tx) => {
      const existing = await this.installs.findByOrganizationIdIncludingDeleted(
        input.orgId,
        tx,
      );
      if (existing) {
        await this.installs.updateTokenAndRaw(
          existing.id,
          { accessToken: input.token, teamId, raw },
          tx,
        );
        return this.installs.findById(existing.id, tx);
      }
      return this.installs.create(
        {
          organizationId: input.orgId,
          accessToken: input.token,
          teamId,
          raw,
        },
        tx,
      );
    });

    // The bundle is what the Electron shell persists to the keychain, so the
    // token survives a wiped data directory and `GET status` has one source.
    this.secrets.update({ SLACK_BOT_TOKEN: input.token });

    this.logger.log(`Slack connected for org=${input.orgId} team=${teamId}`);
    return serialize(row!);
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

    // The same Slack workspace may be connected to several workspaces here, and
    // `auth.revoke` kills the bot token for all of them — so only revoke when
    // this row is the last active holder of the workspace. A null teamId (row
    // predating the team_id backfill, or an auth.test without a team) is
    // treated as shared: leaving a token alive until the app is uninstalled in
    // Slack is recoverable, killing another workspace's delivery is not.
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

    if (!skipRevokeReason) {
      this.secrets.update({ SLACK_BOT_TOKEN: undefined });
    }

    this.logger.log(
      `Slack disconnected for org=${orgId} installation=${installationId}`,
    );
  }
}
