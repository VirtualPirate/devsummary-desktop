import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Client, WorkflowStartOptions } from '@temporalio/client';
import { TEMPORAL_CLIENT, TEMPORAL_CONFIG } from './temporal.tokens';
import type { TemporalConfig } from './temporal.config';

// The SDK types `startDelay` as its own `Duration` type (from the `ms` package),
// which isn't resolvable as a standalone import from this package's node_modules
// (it's a transitive dep of @temporalio/client, not hoisted here). Derive it via
// indexed access on the public `WorkflowStartOptions` type instead of `any`.
type Duration = WorkflowStartOptions['startDelay'];

export interface StartOpts {
  args?: unknown[];
  workflowId?: string;
  searchAttributes?: Record<string, string[]>;
  startDelay?: string;
}

@Injectable()
export class TemporalProducerService {
  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly client: Client,
    @Inject(TEMPORAL_CONFIG) private readonly config: TemporalConfig,
  ) {}

  async start(type: string, opts: StartOpts = {}): Promise<string> {
    const handle = await this.client.workflow.start(type, {
      taskQueue: this.config.taskQueue,
      // `start` sets no conflict policy, so a colliding id makes the server
      // reject the start (and the calling endpoint 500) — hence a UUID, not a
      // timestamp plus 8 chars of Math.random.
      workflowId: opts.workflowId ?? `${type}:${randomUUID()}`,
      args: opts.args ?? [],
      searchAttributes: opts.searchAttributes,
      startDelay: opts.startDelay as Duration,
    });
    return handle.workflowId;
  }

  async startDeduped(type: string, opts: StartOpts): Promise<string> {
    if (!opts.workflowId) throw new Error('startDeduped requires a workflowId');
    const handle = await this.client.workflow.start(type, {
      taskQueue: this.config.taskQueue,
      workflowId: opts.workflowId,
      workflowIdConflictPolicy: 'USE_EXISTING',
      args: opts.args ?? [],
      searchAttributes: opts.searchAttributes,
      startDelay: opts.startDelay as Duration,
    });
    return handle.workflowId;
  }
}
