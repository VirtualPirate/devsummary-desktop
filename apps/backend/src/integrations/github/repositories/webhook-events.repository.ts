import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  GithubWebhookEventInsert,
  GithubWebhookEventSelect,
} from '../../../databases/kysely';

export type GithubWebhookEventCreateInput = Omit<
  GithubWebhookEventInsert,
  'raw'
> & {
  raw: unknown;
};

@Injectable()
export class GithubWebhookEventsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async create(
    input: GithubWebhookEventCreateInput,
    tx?: AppDatabase,
  ): Promise<GithubWebhookEventSelect> {
    const { raw, ...rest } = input;
    return this.exec(tx)
      .insertInto('github.webhookEvents')
      .values({ ...rest, raw: JSON.stringify(raw) })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async markProcessed(id: string): Promise<void> {
    await this.db
      .updateTable('github.webhookEvents')
      .set({ state: 'processed', updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
