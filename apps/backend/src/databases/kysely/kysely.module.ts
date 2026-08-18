import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { Database } from './database.types';
import { KYSELY_DB } from './kysely.token';

// int8 comes back from Postgres as a string by default; the GitHub tables
// store GitHub ids as bigint, so parse to JS BigInt. This also makes
// count()/sum() over int8 return BigInt — convert with Number() at call sites.
types.setTypeParser(types.builtins.INT8, (value) => BigInt(value));

export type AppDatabase = Kysely<Database>;

@Global()
@Module({
  providers: [
    {
      provide: KYSELY_DB,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
        return new Kysely<Database>({
          dialect: new PostgresDialect({
            pool: new Pool({ connectionString: databaseUrl }),
          }),
          plugins: [new CamelCasePlugin()],
        });
      },
    },
  ],
  exports: [KYSELY_DB],
})
export class KyselyModule implements OnModuleDestroy {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
