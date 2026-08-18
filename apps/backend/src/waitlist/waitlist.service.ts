import { Inject, Injectable } from '@nestjs/common';
import { type AppDatabase, KYSELY_DB } from '../databases/kysely';

/**
 * Stores pre-launch signups in `marketing.waitlist`.
 *
 * Dedupe is the table's unique index on `email`, not a read-then-write here:
 * two submissions of the same address racing each other would both see no row
 * and both insert. A repeat signup is therefore a no-op that still reports
 * success, which is also what stops the endpoint from telling a stranger
 * whether an address is already on the list.
 */
@Injectable()
export class WaitlistService {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async join(email: string): Promise<void> {
    await this.db
      .insertInto('marketing.waitlist')
      .values({ email })
      .onConflict((oc) => oc.column('email').doNothing())
      .execute();
  }
}
