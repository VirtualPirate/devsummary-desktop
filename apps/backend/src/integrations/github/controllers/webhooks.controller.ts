import { randomUUID } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { AppError } from '../../../common/errors';
import {
  TemporalProducerService,
  WORKFLOW,
  buildSearchAttributes,
} from '../../../temporal';
import type { GithubAppConfig } from '../github-app.config';
import { GITHUB_APP_CONFIG_TOKEN } from '../tokens';
import { GithubInstallationsRepository } from '../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../repositories/repositories.repository';
import { GithubWebhookEventsRepository } from '../repositories/webhook-events.repository';
import { parsePushEvent } from '../services/push-event';
import { WebhookVerifierService } from '../services/webhook-verifier.service';

@Controller('api/integrations/github/webhook')
@AllowAnonymous()
export class GithubWebhooksController {
  private readonly logger = new Logger(GithubWebhooksController.name);

  constructor(
    private readonly verifier: WebhookVerifierService,
    private readonly webhookEvents: GithubWebhookEventsRepository,
    private readonly reposRepository: GithubRepositoriesRepository,
    private readonly installationsRepository: GithubInstallationsRepository,
    private readonly temporal: TemporalProducerService,
    @Inject(GITHUB_APP_CONFIG_TOKEN)
    private readonly config: GithubAppConfig | null,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
  ): Promise<{ ok: true }> {
    if (!this.config) {
      throw AppError.GITHUB_APP_NOT_CONFIGURED();
    }

    const rawBody = req.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      throw AppError.GITHUB_WEBHOOK_SIGNATURE_INVALID();
    }

    this.verifier.verify({
      body: rawBody,
      signature,
      secret: this.config.webhookSecret,
    });

    const parsed =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : null;

    let outboxId: string | null = null;
    if (parsed) {
      outboxId = typeof deliveryId === 'string' ? deliveryId : randomUUID();
      await this.webhookEvents.create({
        id: outboxId,
        event: event ?? null,
        raw: parsed,
      });
    }

    const installationId =
      (
        parsed?.installation as { id?: number | string } | undefined
      )?.id?.toString() ?? null;

    this.logger.log(
      `github webhook received event=${event ?? '?'} delivery=${deliveryId ?? '?'} installation=${installationId ?? '?'}`,
    );

    if (
      parsed &&
      event === 'member' &&
      typeof parsed.action === 'string' &&
      ['added', 'removed', 'edited'].includes(parsed.action)
    ) {
      const routed = await this.resolveRepo(parsed, deliveryId);
      if (routed) {
        await this.temporal.start(WORKFLOW.syncRepoCollaborators, {
          args: [
            {
              repositoryId: routed.repositoryId,
              trigger: 'webhook',
              organizationId: routed.organizationId,
            },
          ],
          searchAttributes: buildSearchAttributes({
            organizationId: routed.organizationId,
            phase: 'fetching',
          }),
        });
      }
    }

    // The only event that means "there are commits we have not read". A PR merge
    // arrives here too, as a push to the base branch.
    if (parsed && event === 'push') {
      const push = parsePushEvent(parsed);
      if (!push) {
        this.logger.log(
          `github webhook push ignored: nothing to ingest (tag, branch deletion, or no commits) delivery=${deliveryId ?? '?'}`,
        );
      } else {
        const routed = await this.resolveRepo(parsed, deliveryId);
        if (routed) {
          // Whether the branch is the one this repository reads, and whether any
          // of these commits are actually new, is decided by the workflow's plan
          // activity — the DB reads for that belong on the worker, not on
          // GitHub's request. The id makes a redelivery of the same push reuse
          // the run rather than start a second one, and keeps the
          // `<prefix>:<repositoryId>:…` shape `IngestStatusService` parses.
          await this.temporal.startDeduped(WORKFLOW.ingestNewCommits, {
            workflowId: `push:${routed.repositoryId}:${push.branch}:${push.headSha}`,
            args: [
              {
                repositoryId: routed.repositoryId,
                branch: push.branch,
                trigger: 'push',
                runKey: push.headSha,
                shas: push.shas,
                truncated: push.truncated,
                earliestPushedISO: push.earliestPushedISO,
                organizationId: routed.organizationId,
              },
            ],
            searchAttributes: buildSearchAttributes({
              organizationId: routed.organizationId,
              phase: 'fetching',
            }),
          });
        }
      }
    }

    // Every stored delivery is terminal here: retries would not help (we already
    // 200'd) and there is no re-processor, so anything left `pending` is a
    // permanent silent drop.
    if (outboxId) {
      await this.webhookEvents.markProcessed(outboxId);
    }

    return { ok: true };
  }

  /**
   * The repository and organization a delivery belongs to, or `null` when it
   * cannot be routed. Nothing re-processes `github.webhook_events` and the row is
   * marked terminal regardless, so an unroutable event is a dropped change — name
   * it rather than dropping it silently.
   *
   * A workflow started without an organization id still mutates org-scoped rows
   * while being invisible in that org's background-jobs toast, which is why a
   * missing installation is a refusal rather than a system-scoped start.
   */
  private async resolveRepo(
    parsed: Record<string, unknown>,
    deliveryId: string | undefined,
  ): Promise<{ repositoryId: string; organizationId: string } | null> {
    const githubRepoId = (
      parsed.repository as { id?: number | string } | undefined
    )?.id;
    const repo =
      githubRepoId == null
        ? null
        : await this.reposRepository.findByGithubRepoId(BigInt(githubRepoId));
    const installation =
      repo && !repo.deletedAt
        ? await this.installationsRepository.findById(repo.installationId)
        : null;

    if (!repo || !installation?.organizationId) {
      this.logger.warn(
        `github webhook ignored: no live repository/installation for githubRepoId=${githubRepoId ?? '?'} delivery=${deliveryId ?? '?'}`,
      );
      return null;
    }
    return {
      repositoryId: repo.id,
      organizationId: installation.organizationId,
    };
  }
}
