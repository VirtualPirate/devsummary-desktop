import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JobQueueService } from '../../jobs';
import { GithubInstallationsService } from '../../integrations/github/services/installations.service';
import { SlackInstallationsService } from '../../integrations/slack/services/installations.service';

/**
 * Releases everything an organization holds *outside* its own database rows,
 * before the row is deleted.
 *
 * `organizations` is hard-deleted and every child cascades, so by the time the
 * DELETE returns there is nothing left that names the Slack bot token or the
 * GitHub installation — the tokens stay live on the third party with no row to
 * find them from, and the job runner keeps retrying handlers against rows that
 * no longer exist. This has to run while those rows are still there.
 *
 * Every step is best-effort: a Slack or GitHub outage must not make an
 * organization undeletable. A failed step logs at `error` with the org id and
 * what was left live, so it can be cleaned up by hand.
 */
@Injectable()
export class OrganizationTeardownService {
  private readonly logger = new Logger(OrganizationTeardownService.name);

  constructor(
    private readonly queue: JobQueueService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async run(organizationId: string): Promise<void> {
    await this.revokeSlack(organizationId);
    await this.uninstallGithub(organizationId);
    // Last, not first: the GitHub disconnect above enqueues a collaborator-sync
    // job per repository it drops, and those would outlive the org just like the
    // ones already queued.
    await this.cancelJobs(organizationId);
  }

  private async revokeSlack(organizationId: string): Promise<void> {
    try {
      // Resolved through ModuleRef because SlackIntegrationsModule does not
      // export this provider. Going through the service (rather than the
      // exported repository + client) keeps its shared-workspace guard, which
      // skips `auth.revoke` when another org still holds the same team_id.
      const slack = this.moduleRef.get(SlackInstallationsService, {
        strict: false,
      });
      for (const installation of await slack.listForOrg(organizationId)) {
        await slack.disconnect(organizationId, installation.id);
      }
    } catch (err) {
      this.logger.error(
        `Slack teardown failed for org=${organizationId}; its bot token is still LIVE on the Slack workspace and must be revoked by hand: ${describe(err)}`,
      );
    }
  }

  private async uninstallGithub(organizationId: string): Promise<void> {
    try {
      const github = this.moduleRef.get(GithubInstallationsService, {
        strict: false,
      });
      // `disconnect` takes the org alone (one stored credential per workspace)
      // and throws when there is nothing to disconnect, so ask first rather than
      // logging a scary teardown failure for an org that never connected.
      if ((await github.listForOrg(organizationId)).length > 0) {
        await github.disconnect(organizationId);
      }
    } catch (err) {
      this.logger.error(
        `GitHub teardown failed for org=${organizationId}; its stored GitHub token is still LIVE and must be revoked by hand: ${describe(err)}`,
      );
    }
  }

  /**
   * There is nothing to terminate: a job is a row plus, at most, one in-flight
   * handler call. Everything not started is deleted outright, and the org is
   * flagged so the handler that *is* running stops at its next checkpoint (and
   * so the runner drops anything claimed in the race). Deleting the running row
   * would only make the runner re-claim it — the flag is what stops it.
   */
  private async cancelJobs(organizationId: string): Promise<void> {
    try {
      const deleted = await this.queue.abortOrganization(organizationId);
      this.logger.log(
        `dropped ${deleted} queued job(s) for deleted org=${organizationId}`,
      );
    } catch (err) {
      this.logger.error(
        `Could not drop jobs for org=${organizationId}; queued ones will keep retrying against deleted rows: ${describe(err)}`,
      );
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
