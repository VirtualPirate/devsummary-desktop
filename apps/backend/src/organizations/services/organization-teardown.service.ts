import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Client } from '@temporalio/client';
import { SA_ORG, TEMPORAL_CLIENT } from '../../temporal';
import { GithubInstallationsService } from '../../integrations/github/services/installations.service';
import { SlackInstallationsService } from '../../integrations/slack/services/installations.service';

/**
 * Releases everything an organization holds *outside* its own database rows,
 * before the row is deleted.
 *
 * `organizations` is hard-deleted and every child cascades, so by the time the
 * DELETE returns there is nothing left that names the Slack bot token or the
 * GitHub installation — the tokens stay live on the third party with no row to
 * find them from, and Temporal keeps retrying workflows against rows that no
 * longer exist. This has to run while those rows are still there.
 *
 * Every step is best-effort: a Slack or GitHub outage must not make an
 * organization undeletable. A failed step logs at `error` with the org id and
 * what was left live, so it can be cleaned up by hand.
 */
@Injectable()
export class OrganizationTeardownService {
  private readonly logger = new Logger(OrganizationTeardownService.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    private readonly moduleRef: ModuleRef,
  ) {}

  async run(organizationId: string): Promise<void> {
    await this.revokeSlack(organizationId);
    await this.uninstallGithub(organizationId);
    // Last, not first: the GitHub disconnect above starts a collaborator-sync
    // workflow per repository it drops, and those would outlive the org just
    // like the ones already running.
    await this.terminateWorkflows(organizationId);
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
      for (const installation of await github.listForOrg(organizationId)) {
        await github.disconnect(organizationId, installation.id);
      }
    } catch (err) {
      this.logger.error(
        `GitHub teardown failed for org=${organizationId}; the GitHub App is still INSTALLED with repository read access and must be uninstalled by hand: ${describe(err)}`,
      );
    }
  }

  private async terminateWorkflows(organizationId: string): Promise<void> {
    const reason = `organization ${organizationId} deleted`;
    try {
      // Visibility queries are assembled by interpolation; the org id comes
      // from OrgContextGuard, but escape anyway so a stray quote cannot extend
      // the query.
      const query = `${SA_ORG} = '${organizationId.replace(/'/g, "''")}' AND ExecutionStatus = 'Running'`;
      for await (const wf of this.temporal.workflow.list({ query })) {
        try {
          await this.temporal.workflow
            .getHandle(wf.workflowId, wf.runId)
            .terminate(reason);
        } catch (err) {
          // Most likely it just finished on its own between list and terminate.
          this.logger.error(
            `Failed to terminate workflow ${wf.workflowId} for deleted org=${organizationId}: ${describe(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Could not list workflows for org=${organizationId}; any running ones will keep retrying against deleted rows: ${describe(err)}`,
      );
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
