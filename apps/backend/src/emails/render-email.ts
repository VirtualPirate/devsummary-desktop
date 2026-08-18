import { render } from '@react-email/render';
import { OtpEmail } from './otp-email';
import { InviteEmail, type InviteEmailProps } from './invite-email';

export type OtpType = 'email-verification' | 'sign-in' | 'forget-password';

interface TypeConfig {
  subject: (otp: string) => string;
  heading: string;
  description: string;
}

const typeConfig: Record<string, TypeConfig> = {
  'email-verification': {
    subject: (otp) => `Verify your email: ${otp}`,
    heading: 'Verify your email',
    description: 'Enter this code to verify your email address.',
  },
  'sign-in': {
    subject: (otp) => `Your sign-in code: ${otp}`,
    heading: 'Sign in to LaunchStack',
    description: 'Enter this code to sign in to your account.',
  },
  'forget-password': {
    subject: (otp) => `Reset your password: ${otp}`,
    heading: 'Reset your password',
    description: 'Enter this code to reset your password.',
  },
};

const defaultConfig: TypeConfig = {
  subject: (otp) => `Your verification code: ${otp}`,
  heading: 'Verification Code',
  description: 'Enter this code to continue.',
};

export async function renderOtpEmail(
  otp: string,
  type: string,
): Promise<{ subject: string; html: string; text: string }> {
  const config = typeConfig[type] ?? defaultConfig;
  const subject = config.subject(otp);

  const html = await render(
    OtpEmail({ otp, heading: config.heading, description: config.description }),
  );
  const text = await render(
    OtpEmail({ otp, heading: config.heading, description: config.description }),
    { plainText: true },
  );

  return { subject, html, text };
}

export async function renderInviteEmail(
  props: InviteEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const subject = `${props.inviterName} invited you to ${props.organizationName}`;
  const html = await render(InviteEmail(props));
  const text = await render(InviteEmail(props), { plainText: true });
  return { subject, html, text };
}
