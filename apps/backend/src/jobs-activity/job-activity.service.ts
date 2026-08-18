import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { JobActivityResponse } from '@launchstack/api-interfaces';
import { KYSELY_DB, type AppDatabase } from '../databases/kysely';
import type { Phase } from '../jobs';

const EMPTY: JobActivityResponse = {
  active: false,
  fetching: 0,
  analyzing: 0,
  generating: 0,
};

const ORGANIZATION_ID_SCHEMA = z.uuid();

/**
 * Aggregates running jobs into the three brief-pipeline phases the frontend
 * shows in its "background jobs" toast.
 *
 * Each job that participates in the pipeline (scan/backfill-commits/
 * collaborator-sync → fetching, analyze-repo → analyzing, generate-brief/
 * backfill-briefs → generating) carries its phase on the row. Counts are read
 * from the `jobs` table, so they self-clear when a job finishes — a successful
 * handler deletes its row, and crash recovery moves an orphaned `running` row
 * back to `pending`. There is nothing to decrement and no drift.
 */
@Injectable()
export class JobActivityService {
  private readonly logger = new Logger(JobActivityService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async forOrganization(organizationId: string): Promise<JobActivityResponse> {
    if (!ORGANIZATION_ID_SCHEMA.safeParse(organizationId).success) {
      // Fail closed, like a failed query below: this only feeds a toast, so a
      // bad id is worth a log line, not an error thrown into the request.
      this.logger.warn(
        'job-activity called with a non-uuid organization id; reporting no activity',
      );
      return EMPTY;
    }

    try {
      const rows = await this.db
        .selectFrom('jobs')
        // count(*) is int8, which the type parser returns as a BigInt — cast it
        // in SQL rather than shipping a BigInt into a JSON response.
        .select(['phase', sql<number>`count(*)::int`.as('count')])
        .where('state', '=', 'running')
        .where('organizationId', '=', organizationId)
        .where('phase', 'is not', null)
        .groupBy('phase')
        .execute();

      const count = (phase: Phase): number =>
        rows.find((row) => row.phase === phase)?.count ?? 0;

      const fetching = count('fetching');
      const analyzing = count('analyzing');
      const generating = count('generating');

      return {
        fetching,
        analyzing,
        generating,
        active: fetching + analyzing + generating > 0,
      };
    } catch (err) {
      // A loading hint must never break the request — degrade to "no activity".
      this.logger.warn(
        `job-activity query failed; reporting no activity: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return EMPTY;
    }
  }
}
