import { createTransport, type Transporter } from 'nodemailer';

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * One place builds the transport, so the brief sender and the "send test email"
 * button cannot disagree about implicit TLS. 465 is SMTPS (TLS from the first
 * byte); 587 and 25 are STARTTLS, which nodemailer negotiates on its own.
 */
export function smtpTransport(settings: SmtpSettings): Transporter {
  return createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.pass },
  });
}
