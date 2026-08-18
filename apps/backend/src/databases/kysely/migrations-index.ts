import type { Migration, MigrationProvider } from 'kysely';

import * as m00001 from '../../migrations/00001_init';
import * as m00002 from '../../migrations/00002_allow_multiple_orgs_per_owner';
import * as m00003 from '../../migrations/00003_github_installation_unique_active_only';
import * as m00004 from '../../migrations/00004_slack_installation_team_id';
import * as m00005 from '../../migrations/00005_organization_single_owner';
import * as m00006 from '../../migrations/00006_brief_dispatch_hardening';
import * as m00007 from '../../migrations/00007_brief_highlights';
import * as m00008 from '../../migrations/00008_repository_branches';
import * as m00009 from '../../migrations/00009_collaborators_from_commit_authors';
import * as m00010 from '../../migrations/00010_brief_period_timezone';
import * as m00011 from '../../migrations/00011_brief_period_half_open';
import * as m00012 from '../../migrations/00012_brief_commit_clock';
import * as m00013 from '../../migrations/00013_marketing_waitlist';
import * as m00014 from '../../migrations/00014_brief_delivered_channels';
import * as m00015 from '../../migrations/00015_jobs';
import * as m00016 from '../../migrations/00016_seed_local_singleton';

/**
 * Every migration, imported statically.
 *
 * Kysely's `FileMigrationProvider` reads the migrations directory at runtime.
 * Inside a packaged Electron asar there is no reliable directory listing, so the
 * list is a static import graph instead — the bundler/compiler can see it and it
 * cannot silently come back empty on a user's machine (an empty provider is an
 * "already up to date" no-op, i.e. a silently unmigrated database).
 *
 * Keys are sorted lexicographically by Kysely's `Migrator`, which is why they
 * are zero-padded. Adding a migration means adding a line here — `db:up` will
 * not see a file that is not in this list.
 *
 * BUILD NOTE: `migrations/` sits outside `tsconfig.build.json`'s
 * `rootDir: "./src"`, so `nest build` reports TS6059 on these imports. Fix when
 * wiring the packaged build (P8/P10): drop `"migrations"` from that file's
 * `exclude`, set `"rootDir": "./"`, and repoint `package.json#main` and
 * `start:prod` at `dist/src/main.js`. Nothing in Phase 2 depends on it — see
 * docs/receipts/PHASE-2.md.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '00001_init': m00001,
  '00002_allow_multiple_orgs_per_owner': m00002,
  '00003_github_installation_unique_active_only': m00003,
  '00004_slack_installation_team_id': m00004,
  '00005_organization_single_owner': m00005,
  '00006_brief_dispatch_hardening': m00006,
  '00007_brief_highlights': m00007,
  '00008_repository_branches': m00008,
  '00009_collaborators_from_commit_authors': m00009,
  '00010_brief_period_timezone': m00010,
  '00011_brief_period_half_open': m00011,
  '00012_brief_commit_clock': m00012,
  '00013_marketing_waitlist': m00013,
  '00014_brief_delivered_channels': m00014,
  '00015_jobs': m00015,
  '00016_seed_local_singleton': m00016,
};

export const staticMigrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve(MIGRATIONS),
};
