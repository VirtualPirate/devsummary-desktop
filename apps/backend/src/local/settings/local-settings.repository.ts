import { Inject, Injectable } from '@nestjs/common';
import type { LocalSettingsUsage } from '@launchstack/api-interfaces';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';

/** Keys used in `local_settings`. */
export const DESKTOP_NOTIFICATIONS_KEY = 'desktop_notifications';

/**
 * Thin key/value accessor over the machine-local `local_settings` table, plus
 * the settings screen's one read-only aggregate. It holds preferences, never
 * credentials — those live in the OS keychain and reach this process as env
 * (see `SecretsService`).
 */
@Injectable()
export class LocalSettingsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db
      .selectFrom('localSettings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    return row === undefined ? fallback : (row.value as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db
      .insertInto('localSettings')
      .values({ key, value: JSON.stringify(value) })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({ value: JSON.stringify(value) }),
      )
      .execute();
  }

  /** Default on: a brief the user never sees is a brief that did not land. */
  desktopNotificationsEnabled(): Promise<boolean> {
    return this.get(DESKTOP_NOTIFICATIONS_KEY, true);
  }

  setDesktopNotifications(enabled: boolean): Promise<void> {
    return this.set(DESKTOP_NOTIFICATIONS_KEY, enabled);
  }

  /**
   * Every OpenAI token this workspace has spent, from the counts already stored
   * per commit analysis and per brief (invariant §4.7). Analyses reach an
   * organization only through repository → installation, which is why the two
   * halves are separate queries rather than one.
   *
   * `sum` over an int column is `bigint` in Postgres and arrives as a JS
   * `BigInt` through the int8 parser — hence `Number()` rather than a cast.
   */
  async tokenTotals(organizationId: string): Promise<LocalSettingsUsage> {
    const analysis = await this.db
      .selectFrom('github.commitAnalyses')
      .innerJoin(
        'github.commits',
        'github.commits.id',
        'github.commitAnalyses.commitId',
      )
      .innerJoin(
        'github.repositories',
        'github.repositories.id',
        'github.commits.repositoryId',
      )
      .innerJoin(
        'github.installations',
        'github.installations.id',
        'github.repositories.installationId',
      )
      .select((eb) => [
        eb.fn.sum('github.commitAnalyses.promptTokens').as('prompt'),
        eb.fn.sum('github.commitAnalyses.completionTokens').as('completion'),
      ])
      .where('github.installations.organizationId', '=', organizationId)
      .where('github.commitAnalyses.deletedAt', 'is', null)
      .executeTakeFirstOrThrow();

    const briefs = await this.db
      .selectFrom('briefs.briefs')
      .select((eb) => [
        eb.fn.sum('promptTokens').as('prompt'),
        eb.fn.sum('completionTokens').as('completion'),
      ])
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();

    return {
      analysisPromptTokens: count(analysis.prompt),
      analysisCompletionTokens: count(analysis.completion),
      briefPromptTokens: count(briefs.prompt),
      briefCompletionTokens: count(briefs.completion),
    };
  }
}

/** `sum()` over no rows is NULL, and over rows it is bigint. */
function count(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}
