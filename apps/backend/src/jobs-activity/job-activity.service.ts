import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import { z } from 'zod';
import type { JobActivityResponse } from '@launchstack/api-interfaces';
import { TEMPORAL_CLIENT, SA_ORG, SA_PHASE, type Phase } from '../temporal';

const EMPTY: JobActivityResponse = {
  active: false,
  fetching: 0,
  analyzing: 0,
  generating: 0,
};

// The visibility query is assembled by interpolation, so the org id is checked
// here rather than trusted from the caller — `OrgContextGuard` validates its
// header today, but this must not depend on a second caller doing the same.
const ORGANIZATION_ID_SCHEMA = z.uuid();

/**
 * Aggregates live Temporal workflow executions into the three brief-pipeline
 * phases the frontend shows in its "background jobs" toast.
 *
 * Each workflow that participates in the pipeline (scan/backfill-commits/
 * collaborator-sync → fetching, analyze-repo → analyzing, generate-brief/
 * backfill-briefs → generating) is started with the custom `OrganizationId`
 * and `Phase` search attributes. Counts are read directly from Temporal
 * Visibility, so they self-clear when a workflow leaves the Running state —
 * there is nothing to decrement and no drift if a worker crashes mid-run.
 */
@Injectable()
export class JobActivityService {
  private readonly logger = new Logger(JobActivityService.name);

  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

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
      const [fetching, analyzing, generating] = await Promise.all(
        (['fetching', 'analyzing', 'generating'] as Phase[]).map((phase) =>
          this.countRunning(organizationId, phase),
        ),
      );
      return {
        fetching,
        analyzing,
        generating,
        active: fetching + analyzing + generating > 0,
      };
    } catch (err) {
      // A fresh boot may not have visibility available yet, etc. A loading
      // hint must never break the request — degrade to "no activity".
      this.logger.warn(
        `job-activity query failed; reporting no activity: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return EMPTY;
    }
  }

  private async countRunning(orgId: string, phase: Phase): Promise<number> {
    const query = `${SA_ORG} = '${escapeSa(orgId)}' AND ExecutionStatus = 'Running' AND ${SA_PHASE} = '${phase}'`;
    const res = await this.client.workflow.count(query);
    return Number(res.count ?? 0);
  }
}

// orgId is a UUID from our own guard, but escape single quotes defensively.
function escapeSa(v: string): string {
  return v.replace(/'/g, "''");
}
