import { ConfigService } from '@nestjs/config';
import { buildTemporalConfig } from './temporal.config';

const cfg = (m: Record<string, string>) =>
  ({ get: (k: string) => m[k] }) as unknown as ConfigService;

describe('buildTemporalConfig', () => {
  it('applies defaults', () => {
    expect(buildTemporalConfig(cfg({}))).toEqual({
      address: 'localhost:7233',
      namespace: 'default',
      taskQueue: 'launchstack',
      maxConcurrentActivities: 20,
      maxConcurrentWorkflowTasks: 20,
    });
  });
  it('honours env overrides', () => {
    const out = buildTemporalConfig(
      cfg({
        TEMPORAL_ADDRESS: 'temporal:7233',
        TEMPORAL_NAMESPACE: 'prod',
        TEMPORAL_TASK_QUEUE: 'ds',
        TEMPORAL_MAX_CONCURRENT_ACTIVITIES: '5',
        TEMPORAL_MAX_CONCURRENT_WORKFLOW_TASKS: '7',
      }),
    );
    expect(out).toEqual({
      address: 'temporal:7233',
      namespace: 'prod',
      taskQueue: 'ds',
      maxConcurrentActivities: 5,
      maxConcurrentWorkflowTasks: 7,
    });
  });
  // 0 is the dangerous one: the SDK accepts it and the worker polls nothing forever.
  it.each(['0', '-1', 'abc', '2.5', ''])(
    'falls back to the default for concurrency value %p',
    (raw) => {
      const out = buildTemporalConfig(
        cfg({ TEMPORAL_MAX_CONCURRENT_ACTIVITIES: raw }),
      );
      expect(out.maxConcurrentActivities).toBe(20);
    },
  );
});
