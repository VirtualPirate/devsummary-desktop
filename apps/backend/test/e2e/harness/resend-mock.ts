export interface CapturedEmail {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

export const capturedEmails: CapturedEmail[] = [];

export function clearCapturedEmails(): void {
  capturedEmails.length = 0;
}

let counter = 0;

/**
 * Stand-in for the `Resend` class.
 *
 * Must return `{ error: null }`: EmailOtpService throws
 * AppError.OTP_EMAIL_SEND_FAILED whenever `error` is truthy, which would turn
 * every OTP test into a 502.
 */
export class ResendMock {
  // Callers pass an API key; it is accepted and ignored.
  constructor() {}

  emails = {
    send: (payload: CapturedEmail) => {
      capturedEmails.push(payload);
      counter += 1;
      return Promise.resolve({
        data: { id: `mock-email-${counter}` },
        error: null,
      });
    },
  };
}
