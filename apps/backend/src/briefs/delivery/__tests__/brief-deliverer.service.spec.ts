import { BriefDelivererService } from '../services/brief-deliverer.service';

function makeService() {
  const briefs = { findById: jest.fn(), update: jest.fn() };
  const schedules = { findById: jest.fn(), update: jest.fn() };
  const desktop = {
    enabled: jest.fn().mockResolvedValue(false),
    send: jest.fn(),
  };
  const svc = new BriefDelivererService(
    briefs as any,
    schedules as any,
    desktop as any,
  );
  return { svc, briefs, schedules, desktop };
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
  status: 'generated',
  deliveredChannels: [] as Array<'desktop'>,
};

describe('BriefDelivererService.deliver', () => {
  it('leaves a brief untouched when notifications are off (nothing to send)', async () => {
    const { svc, briefs } = makeService();
    briefs.findById.mockResolvedValue(baseBrief);
    await svc.deliver('b1');
    expect(briefs.update).not.toHaveBeenCalled();
  });

  it('marks delivered when the desktop notification goes out', async () => {
    const { svc, briefs, desktop } = makeService();
    briefs.findById.mockResolvedValue(baseBrief);
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(desktop.send).toHaveBeenCalled();
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        status: 'delivered',
        deliveredChannels: ['desktop'],
      }),
    );
  });

  it('records the reason but never marks the brief failed when the channel fails', async () => {
    const { svc, briefs, desktop } = makeService();
    briefs.findById.mockResolvedValue(baseBrief);
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockRejectedValue(new Error('desktop channel unavailable'));
    await svc.deliver('b1');
    // The brief generated fine; `failed` would read as a generation failure and
    // hide a summary that exists.
    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: '[desktop] desktop channel unavailable',
    });
    expect(briefs.update).not.toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ status: expect.anything() }),
    );
  });

  it('updates schedule.lastSentAt when delivered via schedule', async () => {
    const { svc, briefs, schedules, desktop } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 'sch1',
    });
    schedules.findById.mockResolvedValue({ id: 'sch1' });
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(schedules.update).toHaveBeenCalledWith(
      'sch1',
      expect.objectContaining({ lastSentAt: expect.any(Date) }),
    );
  });

  it('does not mark lastSentAt when nothing was sent', async () => {
    const { svc, briefs, schedules } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 'sch1',
    });
    schedules.findById.mockResolvedValue({ id: 'sch1' });
    await svc.deliver('b1');
    expect(briefs.update).not.toHaveBeenCalled();
    expect(schedules.update).not.toHaveBeenCalled();
  });

  it('records the reason when its schedule was deleted mid-flight (never claims delivered)', async () => {
    const { svc, briefs, schedules, desktop } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      briefScheduleId: 'sch1',
    });
    schedules.findById.mockResolvedValue(null);

    await svc.deliver('b1');

    expect(desktop.send).not.toHaveBeenCalled();
    expect(briefs.update).toHaveBeenCalledWith('b1', {
      failureReason: expect.stringContaining('was deleted before delivery'),
    });
    expect(schedules.update).not.toHaveBeenCalled();
  });

  it('adds to the channels already sent rather than replacing them', async () => {
    const { svc, briefs, desktop } = makeService();
    briefs.findById.mockResolvedValue({
      ...baseBrief,
      deliveredChannels: ['slack'],
    });
    desktop.enabled.mockResolvedValue(true);
    desktop.send.mockResolvedValue(undefined);
    await svc.deliver('b1');
    expect(briefs.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ deliveredChannels: ['slack', 'desktop'] }),
    );
  });
});
