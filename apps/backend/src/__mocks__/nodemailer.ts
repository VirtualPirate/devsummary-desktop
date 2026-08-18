/**
 * Jest (CJS) cannot load nodemailer's ESM build, and the Phase 7 acceptance
 * runs are mocked rather than pointed at a real mailbox (docs/DELTAS.md D-E).
 * Every created transport is recorded so a test can assert the SMTP options,
 * and `__setSendMail`/`__setVerify` drive the failure paths.
 */
export interface MockTransport {
  options: Record<string, unknown>;
  sendMail: jest.Mock;
  verify: jest.Mock;
}

type SendMail = (options: Record<string, unknown>) => Promise<unknown>;
type Verify = () => Promise<unknown>;

const okSend: SendMail = () =>
  Promise.resolve({ messageId: 'mock-message-id' });
const okVerify: Verify = () => Promise.resolve(true);

const transports: MockTransport[] = [];
let sendMailImpl: SendMail = okSend;
let verifyImpl: Verify = okVerify;

export function createTransport(
  options: Record<string, unknown>,
): MockTransport {
  const transport: MockTransport = {
    options,
    sendMail: jest.fn((opts: Record<string, unknown>) => sendMailImpl(opts)),
    verify: jest.fn(() => verifyImpl()),
  };
  transports.push(transport);
  return transport;
}

export function __transports(): MockTransport[] {
  return transports;
}

export function __latestTransport(): MockTransport {
  const latest = transports[transports.length - 1];
  if (!latest) throw new Error('No nodemailer transport was created');
  return latest;
}

/** Applies to every transport created from now until `__reset()`. */
export function __setSendMail(impl: SendMail): void {
  sendMailImpl = impl;
}

export function __setVerify(impl: Verify): void {
  verifyImpl = impl;
}

export function __reset(): void {
  transports.length = 0;
  sendMailImpl = okSend;
  verifyImpl = okVerify;
}

export default { createTransport };
