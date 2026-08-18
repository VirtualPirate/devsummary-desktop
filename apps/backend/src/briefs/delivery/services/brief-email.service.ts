import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { BriefReportResponse } from '@launchstack/api-interfaces';
import { renderBriefEmailHtml } from './brief-email.html';
import {
  BriefRenderService,
  type RenderableBrief,
} from './brief-render.service';

@Injectable()
export class BriefEmailService {
  private readonly logger = new Logger(BriefEmailService.name);
  private readonly resend: Resend;
  private readonly emailFrom: string;

  constructor(
    private readonly config: ConfigService,
    private readonly render: BriefRenderService,
  ) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
    this.emailFrom = this.config.getOrThrow<string>('EMAIL_FROM');
  }

  async send(
    brief: RenderableBrief,
    recipients: string[],
    report: BriefReportResponse | null,
  ): Promise<void> {
    if (recipients.length === 0) return;
    const html = renderBriefEmailHtml(
      brief,
      report,
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    const subject = this.render.emailSubject(brief);
    const { error } = await this.resend.emails.send({
      from: this.emailFrom,
      to: recipients,
      subject,
      html,
    });
    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }
    this.logger.log(
      `Brief email sent brief=${brief.id} to=${recipients.length}`,
    );
  }
}
