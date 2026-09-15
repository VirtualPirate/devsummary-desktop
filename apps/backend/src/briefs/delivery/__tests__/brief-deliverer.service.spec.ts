import { BriefDelivererService } from '../services/brief-deliverer.service';

function makeService() {
  const briefs = { findById: jest.fn(), update: jest.fn() };
  const schedules = { findById: jest.fn(), update: jest.fn() };
  const slack = { post: jest.fn() };
  const report = { build: jest.fn().mockResolvedValue(null) };
  const desktop = {
    enabled: jest.fn().mockResolvedValue(false),
    send: jest.fn(),
  };
  const svc = new BriefDelivererService(
    briefs as any,
    schedules as any,
    slack as any,
    report as any,
    desktop as any,
  );
  return { svc, briefs, schedules, slack, report, desktop };
}

const baseBrief = {
  id: 'b1',
  organizationId: 'o1',
  briefScheduleId: null,
  scopeType: 'project' as const,
  scopeProjectId: 'p1',
  scopeTeamId: null,
  scopeCollaboratorId: null,
  scopeRepositoryId: null,
  scopeBranch: null,
  title: 'T',
  briefInfoTitle: 'i',
  summary: 's',
  deliverySlackChannelId: null as string | null,
  status: 'generated',
  deliveredChannels: [] as Array<'slack' | 'desktop'>,
};

describe('BriefDelivererService.deliver', () => {
  it('leaves an ad-hoc brief with no channels untouched (nothing to send)', async () => {
    const { svc, briefs } = makeService();
    briefs.findById.mockResolvedValue(baseBrief);
    await svc.deliver('b1');
    expect(briefs.update).not.toHaveBeenCalled();
  });

  it('marks delivered when slack succeeds', async () => {
    const { svc, briefs, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliverySlackChannelId: 'C123',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(slack.post).toHaveBeenCalled();
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ status: 'delivered' }),
    );
  });

  it('marks delivered when one channel fails but the other succeeds (records failure_reason)', async () => {
    const { svc, briefs, slack, desktop } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliverySlackChannelId: 'C123',
    });
    slack.post.mockRejectedValue(new Error('channel_not_found'));
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        failureReason: expect.stringContaining('channel_not_found'),
      }),
    );
  });

  it('records the reason but never marks the brief failed when every channel fails', async () => {
    const { svc, briefs, slack, desktop } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliverySlackChannelId: 'C123',
    });
    slack.post.mockRejectedValue(new Error('channel_not_found'));
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockRejectedValue(new Error('desktop channel unavailable'));
    await svc.deliver('b1');
    // The brief generated fine; `failed` would read as a generation failure and
    // hide a summary that exists.
    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason:
        '[slack] channel_not_found; [desktop] desktop channel unavailable',
    });
    expect(briefs.update).not.toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ status: expect.anything() }),
    );
  });

  it('updates schedule.lastSentAt when delivered via schedule', async () => {
    const { svc, briefs, schedules, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 'sch1',
    });
    schedules.findById.mockResolvedValue({
      id: 'sch1',
      slackInstallationId: 'i1',
      slackChannelId: 'C123',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(schedules.update).toHaveBeenCalledWith(
      'sch1',
      expect.objectContaining({
        lastSentAt: expect.any(Date),
      }),
    );
  });

  it('does not mark lastSentAt for a schedule with no channels configured', async () => {
    const { svc, briefs, schedules } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 'sch1',
    });
    schedules.findById.mockResolvedValue({
      id: 'sch1',
      slackInstallationId: null,
      slackChannelId: null,
    });
    await svc.deliver('b1');
    expect(briefs.update).not.toHaveBeenCalled();
    expect(schedules.update).not.toHaveBeenCalled();
  });

  it('records the reason when its schedule was deleted mid-flight (never claims delivered)', async () => {
    const { svc, briefs, schedules, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 'sch1',
    });
    schedules.findById.mockResolvedValue(null);

    await svc.deliver('b1');

    expect(slack.post).not.toHaveBeenCalled();
    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: expect.stringContaining('was deleted before delivery'),
    });
    expect(schedules.update).not.toHaveBeenCalled();
  });
});

describe('BriefDelivererService.deliverOne', () => {
  const generated = {
    ...baseBrief,
    generatedAt: new Date('2026-08-01T00:00:00Z'),
    failureReason: null as string | null,
  };

  it('refuses a channel the brief has no recipient for', async () => {
    const { svc, briefs, slack } = makeService();
    briefs.findById.mockResolvedValue(generated);
    await expect(svc.deliverOne('b1', 'slack')).rejects.toMatchObject({
      response: { code: 'BRIEF_DELIVERY_CHANNEL_NOT_CONFIGURED' },
    });
    expect(slack.post).not.toHaveBeenCalled();
  });

  it('refuses a brief that was never generated', async () => {
    const { svc, briefs } = makeService();
    briefs.findById.mockResolvedValue({
      ...generated,
      generatedAt: null,
      deliverySlackChannelId: 'C1',
    });
    await expect(svc.deliverOne('b1', 'slack')).rejects.toMatchObject({
      response: { code: 'BRIEF_NOT_DELIVERABLE' },
    });
  });

  it('throws the upstream reason without downgrading the brief status', async () => {
    const { svc, briefs, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...generated,
      status: 'delivered',
      deliverySlackChannelId: 'C1',
    });
    slack.post.mockRejectedValue(new Error('not_in_channel'));
    await expect(svc.deliverOne('b1', 'slack')).rejects.toMatchObject({
      response: { code: 'BRIEF_DELIVERY_FAILED' },
    });
    expect(briefs.update).not.toHaveBeenCalled();
  });

  it('clears only the retried channel from failure_reason', async () => {
    const { svc, briefs, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...generated,
      status: 'delivered',
      deliverySlackChannelId: 'C1',
      failureReason:
        '[desktop] desktop channel unavailable; [slack] not_in_channel',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliverOne('b1', 'slack');
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        failureReason: '[desktop] desktop channel unavailable',
      }),
    );
  });

  it('uses the schedule channel over the brief column and stamps lastSentAt', async () => {
    const { svc, briefs, schedules, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...generated,
      briefScheduleId: 's1',
      deliverySlackChannelId: 'C-stale',
    });
    schedules.findById.mockResolvedValue({
      id: 's1',
      slackChannelId: 'C-live',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliverOne('b1', 'slack');
    expect(slack.post).toHaveBeenCalledWith(
      'o1',
      expect.anything(),
      'C-live',
      null,
    );
    expect(schedules.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ lastSentAt: expect.any(Date) as Date }),
    );
  });
});

describe('BriefDelivererService report loading', () => {
  it('builds the report once', async () => {
    const { svc, briefs, slack, report } = makeService();
    const figures = { briefId: 'b1' };
    report.build.mockResolvedValue(figures);
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliverySlackChannelId: 'C123',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(report.build).toHaveBeenCalledTimes(1);
    expect(slack.post).toHaveBeenCalledWith(
      'o1',
      expect.anything(),
      'C123',
      figures,
    );
  });

  it('still delivers when the report cannot be built', async () => {
    const { svc, briefs, slack, report } = makeService();
    report.build.mockRejectedValue(new Error('scope query blew up'));
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliverySlackChannelId: 'C123',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(slack.post).toHaveBeenCalledWith(
      'o1',
      expect.anything(),
      'C123',
      null,
    );
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ status: 'delivered' }),
    );
  });

  it('skips the report entirely for a brief with no channels', async () => {
    const { svc, briefs, report } = makeService();
    briefs.findById.mockResolvedValue(baseBrief);
    await svc.deliver('b1');
    expect(report.build).not.toHaveBeenCalled();
  });
});

describe('BriefDelivererService delivered channels', () => {
  it('records only the channels that actually went out', async () => {
    const { svc, briefs, slack, desktop } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliverySlackChannelId: 'C123',
    });
    slack.post.mockResolvedValue(undefined);
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockRejectedValue(new Error('desktop channel unavailable'));
    await svc.deliver('b1');
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ deliveredChannels: ['slack'] }),
    );
  });

  it('adds to the channels already sent rather than replacing them', async () => {
    const { svc, briefs, schedules, slack } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 's1',
      generatedAt: new Date(),
      status: 'delivered',
      deliveredChannels: ['desktop'],
    });
    schedules.findById.mockResolvedValue({
      id: 's1',
      slackChannelId: 'C123',
    });
    slack.post.mockResolvedValue(undefined);
    await svc.deliverOne('b1', 'slack');
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ deliveredChannels: ['desktop', 'slack'] }),
    );
  });
});
