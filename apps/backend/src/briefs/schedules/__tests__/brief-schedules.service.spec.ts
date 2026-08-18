import { BriefSchedulesService } from '../services/brief-schedules.service';
import { CadenceService } from '../services/cadence.service';
import { JOB } from '../../../jobs';

function makeService(env: Record<string, string> = {}) {
  const schedules = {
    listByOrganization: jest.fn(),
    findByIdScopedToOrg: jest.fn(),
    countActiveByOrganization: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const projects = { findByIdScopedToOrg: jest.fn() };
  const teams = { findByIdScopedToOrg: jest.fn() };
  const collaborators = { findByIdScopedToOrg: jest.fn() };
  const repos = { findByIdScopedToOrg: jest.fn() };
  // Default: every repository reads `main`, so scope validation passes unless a
  // test says otherwise.
  const trackedBranches = {
    listByRepository: jest.fn().mockResolvedValue(['main']),
  };
  const slack = { findActiveByOrganizationId: jest.fn() };
  const cadence = new CadenceService();
  const queue = { enqueue: jest.fn().mockResolvedValue('job-id') };
  const appConfig = { get: jest.fn((key: string) => env[key]) };
  const svc = new BriefSchedulesService(
    schedules as any,
    projects as any,
    teams as any,
    collaborators as any,
    repos as any,
    trackedBranches as any,
    slack as any,
    cadence,
    queue as any,
    appConfig as any,
  );
  return {
    svc,
    schedules,
    projects,
    teams,
    collaborators,
    repos,
    trackedBranches,
    slack,
    queue,
    appConfig,
  };
}

async function createdRow(input: any) {
  return {
    ...input,
    id: 'sch-new',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lastSentAt: null,
    paused: false,
    slackInstallationId: null,
    slackChannelId: null,
  };
}

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch1',
    organizationId: 'org-1',
    name: 'T',
    paused: false,
    cadenceType: 'daily',
    cadenceTime: '16:00',
    cadenceDayOfWeek: null,
    cadenceDayOfMonth: null,
    timezone: 'UTC',
    scopeType: 'repository',
    scopeProjectId: null,
    scopeTeamId: null,
    scopeCollaboratorId: null,
    scopeRepositoryId: 'r1',
    nextRunAt: new Date('2026-05-27T16:00:00Z'),
    lastSentAt: null,
    emailRecipients: [],
    slackInstallationId: null,
    slackChannelId: null,
    createdByMemberId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('BriefSchedulesService', () => {
  describe('create', () => {
    it('rejects invalid IANA timezone', async () => {
      const { svc, projects } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'Mars/Phobos',
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({ code: 'BRIEF_SCHEDULE_INVALID_TIMEZONE' });
    });

    it('rejects a fixed-offset timezone that Intl alone accepts', async () => {
      // Node's Intl takes '+05:30'; Postgres takes it in AT TIME ZONE too but
      // with inverted sign semantics, so it must never reach a row.
      const { svc, projects } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: '+05:30',
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({ code: 'BRIEF_SCHEDULE_INVALID_TIMEZONE' });
    });

    it.each(['Asia/Calcutta', 'Asia/Kolkata', 'America/New_York', 'UTC'])(
      'accepts the real IANA id %s (incl. CLDR legacy aliases already stored)',
      async (timezone) => {
        const { svc, projects, schedules } = makeService();
        projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
        schedules.create.mockImplementation(createdRow);
        const out = await svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone,
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        });
        expect(out.timezone).toBe(timezone);
      },
    );

    it('rejects weekly cadence without dayOfWeek (defense in depth past zod)', async () => {
      const { svc, projects } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'weekly', time: '16:00' } as any,
          timezone: 'UTC',
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({ code: 'BRIEF_SCHEDULE_INVALID_CADENCE' });
    });

    it('rejects when scope project is not in org', async () => {
      const { svc, projects } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue(null);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'UTC',
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    });

    it('rejects a repository scope whose repository tracks no branch', async () => {
      const { svc, repos, trackedBranches } = makeService();
      repos.findByIdScopedToOrg.mockResolvedValue({ id: 'r1' });
      trackedBranches.listByRepository.mockResolvedValue([]);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'UTC',
          scope: { type: 'repository', repositoryId: 'r1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({
        code: 'GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED',
      });
    });

    it('rejects a scope branch outside the tracked set', async () => {
      const { svc, repos, trackedBranches } = makeService();
      repos.findByIdScopedToOrg.mockResolvedValue({ id: 'r1' });
      trackedBranches.listByRepository.mockResolvedValue(['main']);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'UTC',
          scope: { type: 'repository', repositoryId: 'r1', branch: 'develop' },
          delivery: {},
        }),
      ).rejects.toMatchObject({
        code: 'GITHUB_REPOSITORY_BRANCH_NOT_TRACKED',
        details: { branch: 'develop' },
      });
    });

    it('rejects slack delivery without active installation', async () => {
      const { svc, projects, slack } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      slack.findActiveByOrganizationId.mockResolvedValue(null);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'UTC',
          scope: { type: 'project', projectId: 'p1' },
          delivery: { slackChannelId: 'C123' },
        }),
      ).rejects.toMatchObject({ code: 'SLACK_INSTALLATION_NOT_FOUND' });
    });

    it('persists with computed next_run_at when valid', async () => {
      const { svc, projects, schedules } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.create.mockImplementation(async (input: any) => ({
        ...input,
        id: 'sch1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        lastSentAt: null,
        paused: false,
        slackInstallationId: null,
        slackChannelId: null,
      }));
      jest.useFakeTimers().setSystemTime(new Date('2026-05-26T10:00:00Z'));
      const out = await svc.create('org-1', 'user-1', {
        name: 'Test',
        cadence: { type: 'daily', time: '16:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId: 'p1' },
        delivery: { emails: ['a@b.com'] },
      });
      expect(out.nextRunAt).toBe('2026-05-26T16:00:00.000Z');
      jest.useRealTimers();
    });

    it('enqueues a backfill job for the new schedule', async () => {
      const { svc, projects, schedules, queue } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.create.mockImplementation(async (input: any) => ({
        ...input,
        id: 'sch-new',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        lastSentAt: null,
        paused: false,
        slackInstallationId: null,
        slackChannelId: null,
      }));
      jest.useFakeTimers().setSystemTime(new Date('2026-05-26T10:00:00Z'));
      await svc.create('org-1', 'user-1', {
        name: 'Test',
        cadence: { type: 'daily', time: '16:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId: 'p1' },
        delivery: {},
      });
      jest.useRealTimers();
      expect(queue.enqueue).toHaveBeenCalledWith(
        JOB.backfillBriefs,
        {
          scheduleId: 'sch-new',
          organizationId: 'org-1',
          backfillMonths: 3,
        },
        expect.objectContaining({
          phase: 'generating',
          organizationId: 'org-1',
        }),
      );
    });

    it('passes the requested backfill window to the workflow', async () => {
      const { svc, projects, schedules, queue } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.create.mockImplementation(createdRow);
      await svc.create('org-1', 'user-1', {
        name: 'Test',
        cadence: { type: 'daily', time: '16:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId: 'p1' },
        delivery: {},
        backfillMonths: 12,
      });
      expect(queue.enqueue).toHaveBeenCalledWith(
        JOB.backfillBriefs,
        {
          scheduleId: 'sch-new',
          organizationId: 'org-1',
          backfillMonths: 12,
        },
        expect.objectContaining({
          phase: 'generating',
          organizationId: 'org-1',
        }),
      );
    });

    it('starts no backfill workflow when the caller asks for no history', async () => {
      const { svc, projects, schedules, queue } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.create.mockImplementation(createdRow);
      await svc.create('org-1', 'user-1', {
        name: 'Test',
        cadence: { type: 'daily', time: '16:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId: 'p1' },
        delivery: {},
        backfillMonths: 0,
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('create — per-org schedule cap', () => {
    it('rejects when the org is already at the limit', async () => {
      const { svc, projects, schedules } = makeService({
        BRIEFS_MAX_SCHEDULES_PER_ORG: '3',
      });
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.countActiveByOrganization.mockResolvedValue(3);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'UTC',
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({
        code: 'BRIEF_SCHEDULE_LIMIT_REACHED',
        message: expect.stringContaining('maximum of 3'),
      });
      expect(schedules.create).not.toHaveBeenCalled();
    });

    it('allows creation one below the limit', async () => {
      const { svc, projects, schedules } = makeService({
        BRIEFS_MAX_SCHEDULES_PER_ORG: '3',
      });
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.countActiveByOrganization.mockResolvedValue(2);
      schedules.create.mockImplementation(async (input: any) =>
        scheduleRow(input),
      );
      await svc.create('org-1', 'user-1', {
        name: 'Test',
        cadence: { type: 'daily', time: '16:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId: 'p1' },
        delivery: {},
      });
      expect(schedules.create).toHaveBeenCalled();
    });

    it('defaults the limit to 20 when the env var is unset', async () => {
      const { svc, projects, schedules } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.countActiveByOrganization.mockResolvedValue(20);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'Test',
          cadence: { type: 'daily', time: '16:00' },
          timezone: 'UTC',
          scope: { type: 'project', projectId: 'p1' },
          delivery: {},
        }),
      ).rejects.toMatchObject({
        code: 'BRIEF_SCHEDULE_LIMIT_REACHED',
        message: expect.stringContaining('maximum of 20'),
      });
    });
  });

  describe('update — scope type change', () => {
    it('writes scope_type when switching repository → project', async () => {
      const { svc, schedules, projects } = makeService();
      schedules.findByIdScopedToOrg.mockResolvedValue(scheduleRow());
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      schedules.update.mockImplementation(async (_id: string, patch: any) =>
        scheduleRow(patch),
      );

      const out = await svc.update('org-1', 'sch1', {
        scope: { type: 'project', projectId: 'p1' },
      });

      expect(schedules.update).toHaveBeenCalledWith('sch1', {
        scopeType: 'project',
        scopeProjectId: 'p1',
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: null,
        scopeBranch: null,
      });
      expect(out.scope).toEqual({ type: 'project', projectId: 'p1' });
    });

    it('writes scope_type when switching project → team', async () => {
      const { svc, schedules, teams } = makeService();
      schedules.findByIdScopedToOrg.mockResolvedValue(
        scheduleRow({
          scopeType: 'project',
          scopeProjectId: 'p1',
          scopeRepositoryId: null,
        }),
      );
      teams.findByIdScopedToOrg.mockResolvedValue({ id: 't1' });
      schedules.update.mockImplementation(async (_id: string, patch: any) =>
        scheduleRow({ scopeRepositoryId: null, ...patch }),
      );

      const out = await svc.update('org-1', 'sch1', {
        scope: { type: 'team', teamId: 't1' },
      });

      expect(schedules.update).toHaveBeenCalledWith('sch1', {
        scopeType: 'team',
        scopeProjectId: null,
        scopeTeamId: 't1',
        scopeCollaboratorId: null,
        scopeRepositoryId: null,
        scopeBranch: null,
      });
      expect(out.scope).toEqual({ type: 'team', teamId: 't1' });
    });
  });

  describe('resume', () => {
    it('recomputes next_run_at from now()', async () => {
      const { svc, schedules } = makeService();
      schedules.findByIdScopedToOrg.mockResolvedValue({
        id: 'sch1',
        organizationId: 'org-1',
        name: 'T',
        paused: true,
        cadenceType: 'daily',
        cadenceTime: '16:00',
        cadenceDayOfWeek: null,
        cadenceDayOfMonth: null,
        timezone: 'UTC',
        scopeType: 'project',
        scopeProjectId: 'p1',
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: null,
        nextRunAt: new Date('2026-05-20T16:00:00Z'),
        lastSentAt: null,
        emailRecipients: [],
        slackInstallationId: null,
        slackChannelId: null,
        createdByMemberId: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      schedules.update.mockImplementation(async (_id: string, patch: any) => ({
        id: 'sch1',
        organizationId: 'org-1',
        name: 'T',
        paused: patch.paused ?? false,
        cadenceType: 'daily',
        cadenceTime: '16:00',
        cadenceDayOfWeek: null,
        cadenceDayOfMonth: null,
        timezone: 'UTC',
        scopeType: 'project',
        scopeProjectId: 'p1',
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: null,
        nextRunAt: patch.nextRunAt,
        lastSentAt: null,
        emailRecipients: [],
        slackInstallationId: null,
        slackChannelId: null,
        createdByMemberId: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));
      jest.useFakeTimers().setSystemTime(new Date('2026-05-26T09:00:00Z'));
      const out = await svc.resume('org-1', 'sch1');
      expect(out.paused).toBe(false);
      expect(out.nextRunAt).toBe('2026-05-26T16:00:00.000Z');
      jest.useRealTimers();
    });
  });
});
