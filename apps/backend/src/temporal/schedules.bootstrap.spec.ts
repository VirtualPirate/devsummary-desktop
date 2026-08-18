/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import { SchedulesBootstrap } from './schedules.bootstrap';
import { WORKFLOW } from './workflow-types';

function makeBootstrap(overrides?: {
  manageSchedules?: string;
  intervalSeconds?: string;
}) {
  const mockHandle = { update: jest.fn().mockResolvedValue(undefined) };
  const mockClient = {
    schedule: {
      create: jest.fn().mockResolvedValue(undefined),
      getHandle: jest.fn(() => mockHandle),
    },
    connection: {
      operatorService: {
        addSearchAttributes: jest.fn().mockResolvedValue(undefined),
      },
    },
  } as any;
  const mockCfg = {
    address: 'x',
    namespace: 'default',
    taskQueue: 'launchstack',
    maxConcurrentActivities: 20,
    maxConcurrentWorkflowTasks: 20,
  };
  const mockConfigService = {
    get: (k: string) =>
      (
        ({
          BRIEFS_DISPATCHER_INTERVAL_SECONDS:
            overrides?.intervalSeconds ?? '60',
          ...(overrides?.manageSchedules !== undefined
            ? { TEMPORAL_MANAGE_SCHEDULES: overrides.manageSchedules }
            : {}),
        }) as Record<string, string>
      )[k],
  } as any;
  const bootstrap = new SchedulesBootstrap(
    mockClient,
    mockCfg,
    mockConfigService,
  );
  return { bootstrap, mockClient, mockHandle, mockCfg, mockConfigService };
}

// A minimal fake matching @temporalio/client's `isGrpcServiceError` shape:
// an Error with string `details` and a record `metadata` (see
// errors.js#isGrpcServiceError), plus the gRPC `code`.
function makeGrpcServiceError(code: number) {
  const err = new Error('rpc error') as Error & {
    code: number;
    details: string;
    metadata: Record<string, unknown>;
  };
  err.code = code;
  err.details = 'rpc error';
  err.metadata = {};
  return err;
}

describe('SchedulesBootstrap', () => {
  it('creates the briefs-dispatch-due schedule with interval + overlap SKIP', async () => {
    const { bootstrap, mockClient } = makeBootstrap();

    await bootstrap.onModuleInit();

    // Two schedules: the brief dispatcher and the nightly commit sweep.
    expect(mockClient.schedule.create).toHaveBeenCalledTimes(2);
    expect(mockClient.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'briefs-dispatch-due',
        spec: { intervals: [{ every: '60s' }] },
        action: expect.objectContaining({
          type: 'startWorkflow',
          workflowType: WORKFLOW.dispatchDueBriefs,
          taskQueue: 'launchstack',
        }),
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      }),
    );
  });

  it('registers the OrganizationId/Phase search attributes before creating the schedule', async () => {
    const { bootstrap, mockClient } = makeBootstrap();

    await bootstrap.onModuleInit();

    const addSearchAttributes =
      mockClient.connection.operatorService.addSearchAttributes;
    expect(addSearchAttributes).toHaveBeenCalledTimes(1);
    expect(addSearchAttributes).toHaveBeenCalledWith({
      namespace: 'default',
      searchAttributes: {
        OrganizationId: 2,
        Phase: 2,
      },
    });
  });

  it('swallows ScheduleAlreadyRunning and resolves without throwing', async () => {
    const { bootstrap, mockClient } = makeBootstrap();
    const alreadyRunning = Object.create(ScheduleAlreadyRunning.prototype);
    (mockClient.schedule.create as jest.Mock).mockRejectedValueOnce(
      alreadyRunning,
    );

    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
  });

  // Regression: `create` is a no-op on an existing Schedule, so a changed
  // BRIEFS_DISPATCHER_INTERVAL_SECONDS never reached a running cluster.
  it('updates the interval of an existing schedule', async () => {
    const { bootstrap, mockClient, mockHandle } = makeBootstrap({
      intervalSeconds: '120',
    });
    (mockClient.schedule.create as jest.Mock).mockRejectedValueOnce(
      Object.create(ScheduleAlreadyRunning.prototype),
    );

    await bootstrap.onModuleInit();

    expect(mockClient.schedule.getHandle).toHaveBeenCalledWith(
      'briefs-dispatch-due',
    );
    type Previous = {
      spec: { intervals: { every: number; offset: number }[] };
    };
    const updateFn = mockHandle.update.mock.calls[0][0] as (
      previous: Previous,
    ) => Previous;
    expect(
      updateFn({ spec: { intervals: [{ every: 60_000, offset: 0 }] } }),
    ).toEqual({
      spec: { intervals: [{ every: 120_000, offset: 0 }] },
    });
  });

  it('swallows an already-registered (ALREADY_EXISTS) search-attribute error and still creates the schedule', async () => {
    const { bootstrap, mockClient } = makeBootstrap();
    (
      mockClient.connection.operatorService.addSearchAttributes as jest.Mock
    ).mockRejectedValueOnce(makeGrpcServiceError(6));

    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
    expect(mockClient.schedule.create).toHaveBeenCalledTimes(2);
  });

  it('creates the github-sweep-daily schedule with a cron + overlap SKIP', async () => {
    const { bootstrap, mockClient } = makeBootstrap();

    await bootstrap.onModuleInit();

    expect(mockClient.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'github-sweep-daily',
        spec: { cronExpressions: ['55 23 * * *'], timezone: 'Etc/UTC' },
        action: expect.objectContaining({
          type: 'startWorkflow',
          workflowType: WORKFLOW.sweepRepositories,
          taskQueue: 'launchstack',
        }),
        // A sweep of a large install can outrun a day; a second one on top would
        // duplicate every child start.
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      }),
    );
  });

  // Same regression as the interval above: `create` no-ops on an existing
  // Schedule, so an edited SWEEP_CRON would never reach a running cluster.
  it('replaces the spec of an existing sweep schedule', async () => {
    const { bootstrap, mockClient, mockHandle } = makeBootstrap();
    (mockClient.schedule.create as jest.Mock)
      .mockResolvedValueOnce(undefined) // dispatch schedule
      .mockRejectedValueOnce(Object.create(ScheduleAlreadyRunning.prototype));

    await bootstrap.onModuleInit();

    expect(mockClient.schedule.getHandle).toHaveBeenCalledWith(
      'github-sweep-daily',
    );
    const updateFn = mockHandle.update.mock.calls[0][0] as (
      previous: unknown,
    ) => { spec: unknown };
    // The whole spec is replaced: a described cron comes back as a parsed
    // structuredCalendar, which must not survive next to the new expression.
    expect(
      updateFn({ spec: { structuredCalendar: [{ hour: [{ start: 23 }] }] } }),
    ).toEqual({
      spec: { cronExpressions: ['55 23 * * *'], timezone: 'Etc/UTC' },
    });
  });

  it('does not create a schedule when TEMPORAL_MANAGE_SCHEDULES is false', async () => {
    const { bootstrap, mockClient } = makeBootstrap({
      manageSchedules: 'false',
    });

    await bootstrap.onModuleInit();

    expect(mockClient.schedule.create).not.toHaveBeenCalled();
    expect(
      mockClient.connection.operatorService.addSearchAttributes,
    ).not.toHaveBeenCalled();
  });
});
