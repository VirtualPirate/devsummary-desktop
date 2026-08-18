import { Inject, Injectable } from '@nestjs/common';
import { decrypt, encrypt } from '../../../auth/crypto';
import {
  KYSELY_DB,
  type AppDatabase,
  type SlackInstallationInsert,
  type SlackInstallationRaw,
  type SlackInstallationSelect,
} from '../../../databases/kysely';
import { SecretsService } from '../../../local/settings/secrets.service';

export type SlackInstallationCreateInput = Omit<
  SlackInstallationInsert,
  'raw'
> & { raw: SlackInstallationRaw };

@Injectable()
export class SlackInstallationsRepository {
  constructor(
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly secrets: SecretsService,
  ) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  /**
   * The bot token is encrypted at rest and decrypted here rather than at each
   * call site, so `accessToken` is plaintext for every reader and no future one
   * can forget. `raw.oauthResponse` deliberately keeps no copy of the token.
   */
  private seal(token: string): string {
    return encrypt(token, this.secrets.encryptionKey());
  }

  private open<T extends SlackInstallationSelect | undefined>(row: T): T {
    if (!row) return row;
    return {
      ...row,
      accessToken: decrypt(row.accessToken, this.secrets.encryptionKey()),
    };
  }

  async findById(
    id: string,
    tx?: AppDatabase,
  ): Promise<SlackInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('slack.installations')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return this.open(row) ?? null;
  }

  async findActiveByOrganizationId(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<SlackInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('slack.installations')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return this.open(row) ?? null;
  }

  async findByOrganizationIdIncludingDeleted(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<SlackInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('slack.installations')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .executeTakeFirst();
    return this.open(row) ?? null;
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<SlackInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('slack.installations')
      .selectAll()
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return this.open(row) ?? null;
  }

  /**
   * True when some *other* active installation holds the same Slack workspace —
   * i.e. revoking this row's bot token would break that organization too.
   */
  async existsOtherActiveByTeamId(
    teamId: string,
    excludeId: string,
    tx?: AppDatabase,
  ): Promise<boolean> {
    const row = await this.exec(tx)
      .selectFrom('slack.installations')
      .select('id')
      .where('teamId', '=', teamId)
      .where('id', '!=', excludeId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async create(
    input: SlackInstallationCreateInput,
    tx?: AppDatabase,
  ): Promise<SlackInstallationSelect> {
    const row = await this.exec(tx)
      .insertInto('slack.installations')
      .values({
        ...input,
        accessToken: this.seal(input.accessToken),
        raw: JSON.stringify(input.raw),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.open(row);
  }

  async updateTokenAndRaw(
    id: string,
    input: {
      accessToken: string;
      teamId: string | null;
      raw: SlackInstallationRaw;
    },
    tx?: AppDatabase,
  ): Promise<void> {
    await this.exec(tx)
      .updateTable('slack.installations')
      .set({
        accessToken: this.seal(input.accessToken),
        teamId: input.teamId,
        raw: JSON.stringify(input.raw),
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('slack.installations')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async undelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('slack.installations')
      .set({ deletedAt: null, updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
