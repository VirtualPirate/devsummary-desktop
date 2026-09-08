import * as nodemailer from 'nodemailer';
import { WebClient } from '@slack/web-api';
import { SecretsService } from '../../../local/settings/secrets.service';
import { SlackClient } from '../../../integrations/slack/slack.client';
import { SlackMessagesService } from '../../../integrations/slack/services/messages.service';
import { BriefDelivererService } from '../services/brief-deliverer.service';
import { BriefDesktopService } from '../services/brief-desktop.service';
import { BriefEmailService } from '../services/brief-email.service';
import { BriefRenderService } from '../services/brief-render.service';
import { BriefSlackService } from '../services/brief-slack.service';

/**
 * The plan's Phase 7 acceptance runs (real SMTP account, real Slack workspace)
 * are deferred to mocked verification by docs/DELTAS.md D-E. This is that
 * verification: the *real* leaf senders, the real deliverer, and only the two
 * network clients replaced by their `src/__mocks__` doubles. What it proves is
 * the transport swap — hosted email API to nodemailer/SMTP, Slack OAuth to a
 * pasted bot token — did not change the partial-failure contract in
 * invariant 6b.
 */

// `nodemailer` is jest-mapped to src/__mocks__/nodemailer.ts.
const mail =
  nodemailer as unknown as typeof import('../../../__mocks__/nodemailer');

const SMTP_ENV = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'me@example.com',
  SMTP_PASS: 'app-password',
  EMAIL_FROM: 'DevSummary <me@example.com>',
};

const brief = {
  id: 'b1',
  organizationId: 'o1',
  briefScheduleId: null,
  title: 'Weekly engineering brief',
  briefInfoTitle: 'Acme · week of 1 Aug',
  summary: 'Three fixes and one feature landed.',
  highlights: [],
  deliveryEmails: [] as string[],
  deliverySlackChannelId: null as string | null,
  status: 'generated',
  deliveredChannels: [] as Array<'email' | 'slack'>,
};

function withEnv(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function harness(opts: { smtp: boolean; desktop: boolean }) {
  const restore = withEnv({
    ...(opts.smtp
      ? SMTP_ENV
      : {
          SMTP_HOST: undefined,
          SMTP_PORT: undefined,
          SMTP_USER: undefined,
          SMTP_PASS: undefined,
          EMAIL_FROM: undefined,
        }),
  });
  const secrets = new SecretsService();
  restore();
  const settings = {
    desktopNotificationsEnabled: jest.fn().mockResolvedValue(opts.desktop),
  };

  const config = { getOrThrow: () => 'http://localhost:5173' } as never;
  const render = new BriefRenderService();

  const slackInstalls = {
    findActiveByOrganizationId: jest.fn().mockResolvedValue({
      id: 'inst-1',
      accessToken: 'xoxb-abc',
      raw: { teamId: 'T1' },
    }),
  };
  const slackClient = new SlackClient();
  const slackMessages = new SlackMessagesService(
    slackInstalls as never,
    slackClient,
  );

  const briefs = {
    findById: jest.fn().mockResolvedValue(brief),
    update: jest.fn(),
  };
  const schedules = { findById: jest.fn(), update: jest.fn() };
  const report = { build: jest.fn().mockResolvedValue(null) };

  const deliverer = new BriefDelivererService(
    briefs as never,
    schedules as never,
    new BriefEmailService(config, render, secrets),
    new BriefSlackService(slackMessages, render, config),
    report as never,
    // The fixture brief carries no `scope_*` columns, so the deliverer never
    // reaches the resolver — the subject falls back to naming the cadence.
    { resolve: jest.fn() } as never,
    new BriefDesktopService(settings as never),
  );

  return { deliverer, briefs, secrets };
}

function slackWebClient(): jest.Mocked<WebClient> {
  const instances = (WebClient as unknown as { __mockInstances: WebClient[] })
    .__mockInstances;
  return instances[instances.length - 1] as unknown as jest.Mocked<WebClient>;
}

beforeEach(() => {
  mail.__reset();
  (WebClient as unknown as { __reset: () => void }).__reset();
  delete (process as { parentPort?: unknown }).parentPort;
});

describe('brief delivery over the desktop transports', () => {
  it('delivers over SMTP and Slack together', async () => {
    const { deliverer, briefs } = harness({ smtp: true, desktop: false });
    briefs.findById.mockResolvedValue({
      ...brief,
      deliveryEmails: ['stakeholder@acme.io'],
      deliverySlackChannelId: 'C123',
    });

    await deliverer.deliver('b1');

    const transport = mail.__latestTransport();
    expect(transport.options).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'me@example.com', pass: 'app-password' },
    });
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'DevSummary <me@example.com>',
        to: ['stakeholder@acme.io'],
      }),
    );
    expect(slackWebClient().chat.postMessage).toHaveBeenCalled();
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        deliveredAt: expect.any(Date) as Date,
        failureReason: null,
        deliveredChannels: ['email', 'slack'],
      }),
    );
  });

  it('still delivers when SMTP rejects the password but Slack succeeds', async () => {
    const { deliverer, briefs } = harness({ smtp: true, desktop: false });
    briefs.findById.mockResolvedValue({
      ...brief,
      deliveryEmails: ['stakeholder@acme.io'],
      deliverySlackChannelId: 'C123',
    });
    // Bad app password: the transport authenticates, then refuses.
    mail.__setSendMail(() =>
      Promise.reject(new Error('535 5.7.8 Username and Password not accepted')),
    );

    await deliverer.deliver('b1');

    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        deliveredChannels: ['slack'],
        failureReason: expect.stringContaining('[email]') as string,
      }),
    );
    const [, update] = briefs.update.mock.calls[0] as [
      string,
      { failureReason: string },
    ];
    expect(update.failureReason).toContain('Password not accepted');
    expect(update.failureReason).not.toContain('[slack]');
  });

  it('records both reasons without failing the brief when both credentials are wrong', async () => {
    const { deliverer, briefs } = harness({ smtp: true, desktop: false });
    briefs.findById.mockResolvedValue({
      ...brief,
      deliveryEmails: ['stakeholder@acme.io'],
      deliverySlackChannelId: 'C123',
    });
    mail.__setSendMail(() => Promise.reject(new Error('535 auth failed')));
    (slackWebClient().chat.postMessage as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'invalid_auth',
    });

    await deliverer.deliver('b1');

    const [, update] = briefs.update.mock.calls[0] as [
      string,
      { status?: string; failureReason: string },
    ];
    // The brief generated fine; `failed` would read as a generation failure.
    expect(update.status).toBeUndefined();
    expect(update.failureReason).toContain('[email]');
    expect(update.failureReason).toContain('[slack]');
  });

  it('reports "not configured" rather than crashing when SMTP is unset', async () => {
    const { deliverer, briefs } = harness({ smtp: false, desktop: false });
    briefs.findById.mockResolvedValue({
      ...brief,
      deliveryEmails: ['stakeholder@acme.io'],
    });

    await deliverer.deliver('b1');

    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: expect.stringContaining(
        '[email] email channel not configured',
      ) as string,
    });
  });

  it('leaves a brief generated when nothing is configured and desktop is off', async () => {
    const { deliverer, briefs } = harness({ smtp: false, desktop: false });

    await deliverer.deliver('b1');

    expect(briefs.update).not.toHaveBeenCalled();
  });

  it('lands on the machine when every remote channel is unconfigured but desktop is on', async () => {
    const posted: unknown[] = [];
    (process as { parentPort?: unknown }).parentPort = {
      postMessage: (m: unknown) => posted.push(m),
    };
    const { deliverer, briefs } = harness({ smtp: false, desktop: true });

    await deliverer.deliver('b1');

    expect(posted).toEqual([
      {
        type: 'notification',
        title: 'Weekly engineering brief',
        body: 'Three fixes and one feature landed.',
        briefId: 'b1',
      },
    ]);
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        // `desktop` counts toward "≥1 channel succeeded" *and* is recorded, so
        // a brief that only landed on the machine is distinguishable from one
        // that reached a stakeholder.
        deliveredChannels: ['desktop'],
      }),
    );
  });

  it('records the desktop failure outside Electron instead of claiming delivery', async () => {
    const { deliverer, briefs } = harness({ smtp: false, desktop: true });

    await deliverer.deliver('b1');

    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: '[desktop] desktop channel unavailable',
    });
  });
});

describe('boot without SMTP settings', () => {
  it('constructs the email sender without reading any config', () => {
    const restore = withEnv({
      SMTP_HOST: undefined,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      EMAIL_FROM: undefined,
    });
    const secrets = new SecretsService();
    restore();
    const config = {
      getOrThrow: () => {
        throw new Error('config read at construction time');
      },
    } as never;

    expect(
      () => new BriefEmailService(config, new BriefRenderService(), secrets),
    ).not.toThrow();
    expect(secrets.smtp()).toBeNull();
    expect(secrets.status().smtp).toBe(false);
  });
});
