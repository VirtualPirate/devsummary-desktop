import type { ConfigService } from '@nestjs/config';

export interface TemporalConfig {
  address: string;
  namespace: string;
  taskQueue: string;
  maxConcurrentActivities: number;
  maxConcurrentWorkflowTasks: number;
}

const DEFAULT_MAX_CONCURRENT = 20;

// Reject NaN / 0 / negatives from a malformed env value rather than handing them to the
// SDK, where 0 silently means "poll nothing" and the worker looks alive but never runs.
function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildTemporalConfig(config: ConfigService): TemporalConfig {
  return {
    address: config.get<string>('TEMPORAL_ADDRESS') ?? 'localhost:7233',
    namespace: config.get<string>('TEMPORAL_NAMESPACE') ?? 'default',
    taskQueue: config.get<string>('TEMPORAL_TASK_QUEUE') ?? 'launchstack',
    maxConcurrentActivities: positiveInt(
      config.get<string>('TEMPORAL_MAX_CONCURRENT_ACTIVITIES'),
      DEFAULT_MAX_CONCURRENT,
    ),
    maxConcurrentWorkflowTasks: positiveInt(
      config.get<string>('TEMPORAL_MAX_CONCURRENT_WORKFLOW_TASKS'),
      DEFAULT_MAX_CONCURRENT,
    ),
  };
}
