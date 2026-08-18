import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { renderInviteEmail } from '../../emails/render-email';
import { AppError } from '../../common/errors';

export interface SendInviteEmailInput {
  to: string;
  organizationName: string;
  inviterName: string;
  role: 'admin' | 'viewer';
  acceptUrl: string;
  expiresInDays: number;
}

@Injectable()
export class InviteMailer {
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
    this.from = this.config.getOrThrow<string>('EMAIL_FROM');
  }

  async sendInviteEmail(input: SendInviteEmailInput): Promise<void> {
    const { subject, html, text } = await renderInviteEmail({
      organizationName: input.organizationName,
      inviterName: input.inviterName,
      role: input.role,
      acceptUrl: input.acceptUrl,
      expiresInDays: input.expiresInDays,
    });
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: input.to,
      subject,
      html,
      text,
    });
    if (error) {
      throw AppError.INVITE_EMAIL_SEND_FAILED({ reason: error.message });
    }
  }
}
