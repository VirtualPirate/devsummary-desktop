import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { Resend } from 'resend';
import { renderOtpEmail } from '../emails/render-email';
import { AppError } from '../common/errors';
import type { Auth } from './auth.config';

@Injectable()
export class EmailOtpService {
  private readonly resend: Resend;
  private readonly emailFrom: string;

  constructor(
    private readonly authService: AuthService<Auth>,
    private readonly configService: ConfigService,
  ) {
    this.resend = new Resend(
      this.configService.getOrThrow<string>('RESEND_API_KEY'),
    );
    this.emailFrom = this.configService.getOrThrow<string>('EMAIL_FROM');
  }

  async sendVerificationOtp(
    email: string,
    type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email',
  ): Promise<void> {
    let otp: string;
    try {
      otp = await this.authService.api.createVerificationOTP({
        body: { email, type },
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Failed to create OTP';
      throw AppError.OTP_CREATE_FAILED({ reason });
    }

    const { subject, html, text } = await renderOtpEmail(otp, type);

    const { data, error } = await this.resend.emails.send({
      from: this.emailFrom,
      to: email,
      subject,
      html,
      text,
    });

    if (error) {
      throw AppError.OTP_EMAIL_SEND_FAILED({ reason: error.message });
    }

    console.log('OTP email sent:', data?.id);
  }
}
