import { renderOtpEmail } from './render-email';

describe('renderOtpEmail', () => {
  const otp = '123456';

  it('returns correct subject for email-verification', async () => {
    const result = await renderOtpEmail(otp, 'email-verification');
    expect(result.subject).toBe('Verify your email: 123456');
  });

  it('returns correct subject for sign-in', async () => {
    const result = await renderOtpEmail(otp, 'sign-in');
    expect(result.subject).toBe('Your sign-in code: 123456');
  });

  it('returns correct subject for forget-password', async () => {
    const result = await renderOtpEmail(otp, 'forget-password');
    expect(result.subject).toBe('Reset your password: 123456');
  });

  it('returns fallback subject for unknown type', async () => {
    const result = await renderOtpEmail(otp, 'unknown-type');
    expect(result.subject).toBe('Your verification code: 123456');
  });

  it('returns subject, html, and text strings', async () => {
    const result = await renderOtpEmail(otp, 'email-verification');
    expect(typeof result.subject).toBe('string');
    expect(typeof result.html).toBe('string');
    expect(typeof result.text).toBe('string');
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it.each(['email-verification', 'sign-in', 'forget-password'] as const)(
    'returns non-empty html and text for type: %s',
    async (type) => {
      const result = await renderOtpEmail(otp, type);
      expect(result.html).toBeTruthy();
      expect(result.text).toBeTruthy();
      expect(result.subject).toContain(otp);
    },
  );
});
