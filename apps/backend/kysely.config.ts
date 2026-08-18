import 'dotenv/config';
import { defineConfig } from 'kysely-ctl';
import { Pool } from 'pg';

export default defineConfig({
  dialect: 'pg',
  dialectConfig: {
    pool: new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    }),
  },
  migrations: {
    migrationFolder: 'migrations',
  },
});
