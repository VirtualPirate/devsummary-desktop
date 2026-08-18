import { Injectable } from '@nestjs/common';
import type { JobSelect } from '../databases/kysely';

/**
 * A handler is the whole workflow body: one call, one attempt. Returning means
 * success (the runner deletes the row); throwing means the profile in
 * `job-profiles.ts` decides whether it is retried or dead.
 */
export type JobHandler = (
  args: Record<string, unknown>,
  job: JobSelect,
) => Promise<void>;

/**
 * The registry the runner dispatches through. **Empty on purpose** — Phase 4
 * ports the workflows and registers them from their own feature modules
 * (`registry.register(JOB.generateBrief, (args) => …)` in an `onModuleInit`),
 * so no module here has to import every feature.
 *
 * An unknown type is not a crash: the runner fails that job terminally, which is
 * the honest outcome for a row enqueued by an older build.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) {
      // Two registrations means two implementations and a coin flip over which
      // one runs — always a wiring bug, and silent if it is not thrown.
      throw new Error(`job handler already registered for type '${type}'`);
    }
    this.handlers.set(type, handler);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}
