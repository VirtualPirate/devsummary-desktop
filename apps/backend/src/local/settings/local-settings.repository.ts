import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';

/** Keys used in `local_settings`. */
export const DESKTOP_NOTIFICATIONS_KEY = 'desktop_notifications';

/**
 * Thin key/value accessor over the machine-local `local_settings` table. It
 * holds preferences, never
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
}
