import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BriefReportResponse } from '@launchstack/api-interfaces';
import { SlackMessagesService } from '../../../integrations/slack/services/messages.service';
import {
  BriefRenderService,
  type RenderableBrief,
} from './brief-render.service';

@Injectable()
export class BriefSlackService {
  private readonly logger = new Logger(BriefSlackService.name);

  constructor(
    private readonly slack: SlackMessagesService,
    private readonly render: BriefRenderService,
    private readonly config: ConfigService,
  ) {}

  async post(
    organizationId: string,
    brief: RenderableBrief,
    channelId: string,
    report: BriefReportResponse | null,
  ): Promise<void> {
    const text = this.render.toSlackMarkdown(brief);
    const blocks = this.render.toSlackBlocks(
      brief,
      report,
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    await this.slack.postMessage(organizationId, channelId, text, blocks);
    this.logger.log(
      `Brief slack posted brief=${brief.id} channel=${channelId}`,
    );
  }
}
