import { WebClient } from '@slack/web-api';
import { SlackClient } from '../../../integrations/slack/slack.client';
import { SlackMessagesService } from '../../../integrations/slack/services/messages.service';
import { BriefDelivererService } from '../services/brief-deliverer.service';
import { BriefDesktopService } from '../services/brief-desktop.service';
import { BriefRenderService } from '../services/brief-render.service';
import { BriefSlackService } from '../services/brief-slack.service';

/**
 * The plan's Phase 7 acceptance run (a real Slack workspace) is deferred to
 * mocked verification by docs/DELTAS.md D-E. This is that verification: the
 * *real* leaf senders, the real deliverer, and only the network client replaced
 * by its `src/__mocks__` double. What it proves is that the transport swap —
 * Slack OAuth to a pasted bot token — did not change the partial-failure
 * contract in invariant 6b.
 *
 * Email is not a channel here: docs/DELTAS.md D-H removed it from the desktop
 * build, so Slack and the desktop notification are the whole fan-out.
 */

const brief = {
  id: 'b1',
  organizationId: 'o1',
  briefScheduleId: null,
  title: 'Weekly engineering brief',
  briefInfoTitle: 'Acme · week of 1 Aug',
  summary: 'Three fixes and one feature landed.',
  highlights: [],
  deliverySlackChannelId: null as string | null,
  status: 'generated',
  deliveredChannels: [] as Array<'slack' | 'desktop'>,
};

function harness(opts: { desktop: boolean }) {
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
    new BriefSlackService(slackMessages, render, config),
    report as never,
    new BriefDesktopService(settings as never),
  );

  return { deliverer, briefs };
}

function slackWebClient(): jest.Mocked<WebClient> {
  const instances = (WebClient as unknown as { __mockInstances: WebClient[] })
    .__mockInstances;
  return instances[instances.length - 1] as unknown as jest.Mocked<WebClient>;
}

beforeEach(() => {
  (WebClient as unknown as { __reset: () => void }).__reset();
  delete (process as { parentPort?: unknown }).parentPort;
});

describe('brief delivery over the desktop transports', () => {
  it('delivers over Slack', async () => {
    const { deliverer, briefs } = harness({ desktop: false });
    briefs.findById.mockResolvedValue({
      ...brief,
      deliverySlackChannelId: 'C123',
    });

    await deliverer.deliver('b1');

    expect(slackWebClient().chat.postMessage).toHaveBeenCalled();
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        deliveredAt: expect.any(Date) as Date,
        failureReason: null,
        deliveredChannels: ['slack'],
      }),
    );
  });

  it('records the Slack reason without failing the brief', async () => {
    const { deliverer, briefs } = harness({ desktop: false });
    briefs.findById.mockResolvedValue({
      ...brief,
      deliverySlackChannelId: 'C123',
    });
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
    expect(update.failureReason).toContain('[slack]');
  });

  it('leaves a brief generated when nothing is configured and desktop is off', async () => {
    const { deliverer, briefs } = harness({ desktop: false });

    await deliverer.deliver('b1');

    expect(briefs.update).not.toHaveBeenCalled();
  });

  it('lands on the machine when Slack is unconfigured but desktop is on', async () => {
    const posted: unknown[] = [];
    (process as { parentPort?: unknown }).parentPort = {
      postMessage: (m: unknown) => posted.push(m),
    };
    const { deliverer, briefs } = harness({ desktop: true });

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
    const { deliverer, briefs } = harness({ desktop: true });

    await deliverer.deliver('b1');

    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: '[desktop] desktop channel unavailable',
    });
  });
});
