import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  isGrpcServiceError,
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import { TEMPORAL_CLIENT, TEMPORAL_CONFIG } from './temporal.tokens';
import type { TemporalConfig } from './temporal.config';
import { WORKFLOW } from './workflow-types';
import { SA_ORG, SA_PHASE } from './search-attributes';

// Proto `IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD` (see
// @temporalio/proto's temporal.api.enums.v1.IndexedValueType). Not imported
// directly: @temporalio/proto isn't a resolvable dependency of this package
// (only a transitive one of @temporalio/client), so we use the numeric
// value — TS structurally accepts numeric literals for this enum type.
const INDEXED_VALUE_TYPE_KEYWORD = 2;

// gRPC status code for ALREADY_EXISTS (@grpc/grpc-js `status.ALREADY_EXISTS`),
// used the same way as INDEXED_VALUE_TYPE_KEYWORD above — not imported
// directly since @grpc/grpc-js isn't a resolvable dependency here either.
const GRPC_ALREADY_EXISTS = 6;

const DISPATCH_SCHEDULE_ID = 'briefs-dispatch-due';
const SWEEP_SCHEDULE_ID = 'github-sweep-daily';

/**
 * End of day, UTC. A single fixed time rather than per-organization local
 * midnight: the sweep is a catch-up for commits webhooks missed, and a repository
 * being swept an hour early or late for a given tenant changes nothing — the
 * window is derived from stored history, not from the clock.
 *
 * Code, not env: no install has needed a different hour, and `syncSweepCron`
 * already pushes a changed value to a running cluster on the next API boot, so
 * editing here is the whole deploy. Lift it to config the first time an install
 * needs its own window.
 */
const SWEEP_CRON = '55 23 * * *';
const SWEEP_TIMEZONE = 'Etc/UTC';

@Injectable()
export class SchedulesBootstrap implements OnModuleInit {
  private readonly logger = new Logger('SchedulesBootstrap');
  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly client: Client,
    @Inject(TEMPORAL_CONFIG) private readonly cfg: TemporalConfig,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      (this.config.get<string>('TEMPORAL_MANAGE_SCHEDULES') ?? 'true') ===
      'false'
    )
      return;

    await this.registerSearchAttributes();

    const seconds = Number(
      this.config.get<string>('BRIEFS_DISPATCHER_INTERVAL_SECONDS') ?? '60',
    );
    try {
      await this.client.schedule.create({
        scheduleId: DISPATCH_SCHEDULE_ID,
        spec: { intervals: [{ every: `${seconds}s` }] },
        action: {
          type: 'startWorkflow',
          workflowType: WORKFLOW.dispatchDueBriefs,
          taskQueue: this.cfg.taskQueue,
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      });
      this.logger.log(
        `Schedule '${DISPATCH_SCHEDULE_ID}' created (${seconds}s)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ScheduleAlreadyRunning) {
        await this.syncInterval(seconds);
      } else {
        this.logger.error(`Failed to create dispatch schedule`, msg);
      }
    }

    // After the dispatcher: briefs are the product, the sweep is a backstop, and
    // a cluster that refuses one should still get the other.
    await this.createSweepSchedule();
  }

  // `create` is a no-op once the Schedule exists, so without this a changed
  // BRIEFS_DISPATCHER_INTERVAL_SECONDS would never reach an existing cluster.
  // Idempotent: writing the same interval back is harmless.
  private async syncInterval(seconds: number): Promise<void> {
    try {
      await this.client.schedule
        .getHandle(DISPATCH_SCHEDULE_ID)
        .update((previous) => {
          previous.spec.intervals = [{ every: seconds * 1000, offset: 0 }];
          return previous;
        });
      this.logger.log(
        `Schedule '${DISPATCH_SCHEDULE_ID}' interval set to ${seconds}s`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to update dispatch schedule interval`, msg);
    }
  }

  /**
   * Nightly commit sweep — the backstop behind the `push` webhook, for deliveries
   * that never arrived (subscription missing, worker down, delivery rejected).
   *
   * `SKIP` overlap because a sweep of a large install can outrun a day: a second
   * one starting on top would duplicate every child start, and the children are
   * already deduped per day anyway. Created idempotently and gated exactly like
   * the dispatch schedule; the cron is synced on an existing cluster so an edited
   * `SWEEP_CRON` actually lands.
   */
  private async createSweepSchedule(): Promise<void> {
    try {
      await this.client.schedule.create({
        scheduleId: SWEEP_SCHEDULE_ID,
        spec: { cronExpressions: [SWEEP_CRON], timezone: SWEEP_TIMEZONE },
        action: {
          type: 'startWorkflow',
          workflowType: WORKFLOW.sweepRepositories,
          taskQueue: this.cfg.taskQueue,
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      });
      this.logger.log(
        `Schedule '${SWEEP_SCHEDULE_ID}' created ('${SWEEP_CRON}' ${SWEEP_TIMEZONE})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ScheduleAlreadyRunning) {
        await this.syncSweepCron();
      } else {
        this.logger.error(`Failed to create sweep schedule`, msg);
      }
    }
  }

  /**
   * Replaces the spec wholesale rather than mutating it in place (the way
   * `syncInterval` does): a described cron spec comes back normalised into
   * `structuredCalendar`, so writing `cronExpressions` onto the description would
   * not type-check and, worse, would leave the parsed calendar in place next to it.
   */
  private async syncSweepCron(): Promise<void> {
    try {
      await this.client.schedule
        .getHandle(SWEEP_SCHEDULE_ID)
        .update((previous) => ({
          ...previous,
          spec: { cronExpressions: [SWEEP_CRON], timezone: SWEEP_TIMEZONE },
        }));
      this.logger.log(
        `Schedule '${SWEEP_SCHEDULE_ID}' set to '${SWEEP_CRON}' ${SWEEP_TIMEZONE}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to update sweep schedule cron`, msg);
    }
  }

  // Temporal rejects StartWorkflowExecution for any start that carries an
  // unregistered custom search attribute. Every org-scoped workflow start
  // sets {OrganizationId, Phase}, so on a fresh cluster this must run
  // before anything (including the schedule created below, since its
  // target workflow can itself start org-scoped children) starts a
  // workflow. Idempotent and API-gated like the schedule create above:
  // failures are logged, never thrown, so a misbehaving cluster doesn't
  // crash API boot.
  private async registerSearchAttributes(): Promise<void> {
    try {
      await this.client.connection.operatorService.addSearchAttributes({
        namespace: this.cfg.namespace,
        searchAttributes: {
          [SA_ORG]: INDEXED_VALUE_TYPE_KEYWORD,
          [SA_PHASE]: INDEXED_VALUE_TYPE_KEYWORD,
        },
      });
      this.logger.log(
        `Search attributes '${SA_ORG}'/'${SA_PHASE}' registered on namespace '${this.cfg.namespace}'`,
      );
    } catch (err) {
      if (isGrpcServiceError(err) && Number(err.code) === GRPC_ALREADY_EXISTS) {
        this.logger.log(
          `Search attributes '${SA_ORG}'/'${SA_PHASE}' already registered`,
        );
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to register search attributes`, msg);
    }
  }
}
