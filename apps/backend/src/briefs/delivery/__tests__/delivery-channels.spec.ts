import { BriefDelivererService } from '../services/brief-deliverer.service';
import { BriefDesktopService } from '../services/brief-desktop.service';

/**
 * The real deliverer over the *real* desktop sender, down to the
 * `process.parentPort` message the Electron main process receives. The
 * deliverer's own spec stubs that channel; this is what proves the wire.
 *
 * There is one channel to fan out to: email never shipped (docs/DELTAS.md D-H)
 * and Slack was removed (see the root AGENTS.md, "Deliberately not included").
 */

const brief = {
  id: 'b1',
  organizationId: 'o1',
  briefScheduleId: null,
  title: 'Weekly engineering brief',
  briefInfoTitle: 'Acme · week of 1 Aug',
  summary: 'Three fixes and one feature landed.',
  highlights: [],
  status: 'generated',
  deliveredChannels: [] as Array<'desktop'>,
};

function harness(opts: { desktop: boolean }) {
  const settings = {
    desktopNotificationsEnabled: jest.fn().mockResolvedValue(opts.desktop),
  };
  const briefs = {
    findById: jest.fn().mockResolvedValue(brief),
    update: jest.fn(),
  };
  const schedules = { findById: jest.fn(), update: jest.fn() };

  const deliverer = new BriefDelivererService(
    briefs as never,
    schedules as never,
    new BriefDesktopService(settings as never),
  );

  return { deliverer, briefs };
}

beforeEach(() => {
  delete (process as { parentPort?: unknown }).parentPort;
});

describe('brief delivery over the desktop transport', () => {
  it('leaves a brief generated when notifications are off', async () => {
    const { deliverer, briefs } = harness({ desktop: false });

    await deliverer.deliver('b1');

    expect(briefs.update).not.toHaveBeenCalled();
  });

  it('lands on the machine when notifications are on', async () => {
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
        deliveredAt: expect.any(Date) as Date,
        failureReason: null,
        deliveredChannels: ['desktop'],
      }),
    );
  });

  it('records the desktop failure outside Electron instead of claiming delivery', async () => {
    const { deliverer, briefs } = harness({ desktop: true });

    await deliverer.deliver('b1');

    // The brief generated fine; `failed` would read as a generation failure.
    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: '[desktop] desktop channel unavailable',
    });
  });
});
