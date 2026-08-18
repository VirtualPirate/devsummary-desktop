import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BriefReportResponse } from '@launchstack/api-interfaces';
import { SecretsService } from '../../../local/settings/secrets.service';
import { smtpTransport } from '../../../local/settings/smtp';
import { renderBriefEmailHtml } from './brief-email.html';
import {
  BriefRenderService,
  type RenderableBrief,
} from './brief-render.service';

@Injectable()
export class BriefEmailService {
  private readonly logger = new Logger(BriefEmailService.name);

  /**
   * Nothing is read at construction. The hosted-provider build called
   * `config.getOrThrow` here, which on a desktop app means the whole backend
   * refuses to boot until the user has pasted mail credentials — the one
   * failure mode a settings screen cannot recover from.
   */
  constructor(
    private readonly config: ConfigService,
    private readonly render: BriefRenderService,
    private readonly secrets: SecretsService,
  ) {}

  async send(
    brief: RenderableBrief,
    recipients: string[],
    report: BriefReportResponse | null,
  ): Promise<void> {
    if (recipients.length === 0) return;

    const smtp = this.secrets.smtp();
    if (!smtp) {
      // Throws rather than returning: the deliverer turns this into a recorded
      // `[email] …` failureReason. Returning quietly would mark a brief the
      // user asked to be emailed as delivered with nothing sent.
      throw new Error(
        'email channel not configured: SMTP host, username and password are required',
      );
    }

    const html = renderBriefEmailHtml(
      brief,
      report,
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    const subject = this.render.emailSubject(brief);

    try {
      await smtpTransport(smtp).sendMail({
        from: smtp.from,
        to: recipients,
        subject,
        html,
      });
    } catch (err) {
      throw new Error(
        `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log(
      `Brief email sent brief=${brief.id} to=${recipients.length}`,
    );
  }
}
