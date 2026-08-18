import { Kysely, sql } from 'kysely';

/**
 * Branch-aware ingestion, in two tables.
 *
 * `github.repository_branches` — the branches a repository is *tracked* on. A
 * repository with no live row here is inert: no commit fetch, no analysis, no
 * contribution to briefs. That is what stops connecting the GitHub App from
 * ingesting a branch nobody chose. Soft-deleted rather than hard-deleted so
 * untracking a branch keeps the commits it brought in (they stay linked below).
 *
 * `github.commit_branches` — which branches a commit was seen on. A commit
 * reachable from two branches gets two rows, because `github.commits` is keyed
 * `(repository_id, sha)` and one branch column on it would be first-fetch-wins
 * and therefore a lie. `branch` is text, not a FK into `repository_branches`,
 * on purpose: the attribution has to survive the branch being untracked.
 *
 * `scope_branch` on schedules and briefs narrows a **repository** scope to one
 * branch, so "weekly brief for release/2026.08" is expressible. NULL means
 * every branch of that repository, which is what every existing row means.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('github')
    .createTable('repository_branches')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('repository_id', 'uuid', (col) =>
      col.notNull().references('github.repositories.id').onDelete('cascade'),
    )
    .addColumn('branch', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // Partial: an untracked (soft-deleted) row must not block re-tracking the
  // same branch later, the same way installations handle reconnects.
  await db.schema
    .withSchema('github')
    .createIndex('repository_branches_repo_branch_unique')
    .on('repository_branches')
    .columns(['repository_id', 'branch'])
    .unique()
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('repository_branches_repo_idx')
    .on('repository_branches')
    .column('repository_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('commit_branches')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('commit_id', 'uuid', (col) =>
      col.notNull().references('github.commits.id').onDelete('cascade'),
    )
    .addColumn('branch', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('commit_branches_commit_branch_unique')
    .on('commit_branches')
    .columns(['commit_id', 'branch'])
    .unique()
    .execute();

  // Drives the branch-scoped brief query, which filters commits by repository +
  // date and then needs "was this one on branch X".
  await db.schema
    .withSchema('github')
    .createIndex('commit_branches_branch_commit_idx')
    .on('commit_branches')
    .columns(['branch', 'commit_id'])
    .execute();

  for (const table of ['brief_schedules', 'briefs']) {
    await db.schema
      .withSchema('briefs')
      .alterTable(table)
      .addColumn('scope_branch', 'text')
      .execute();

    // A branch only means something for a repository scope; on a project or
    // team scope it would silently do nothing.
    await db.schema
      .withSchema('briefs')
      .alterTable(table)
      .addCheckConstraint(
        `${table}_scope_branch_requires_repository`,
        sql`scope_branch IS NULL OR scope_type = 'repository'`,
      )
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ['brief_schedules', 'briefs']) {
    await db.schema
      .withSchema('briefs')
      .alterTable(table)
      .dropConstraint(`${table}_scope_branch_requires_repository`)
      .execute();
    await db.schema
      .withSchema('briefs')
      .alterTable(table)
      .dropColumn('scope_branch')
      .execute();
  }

  await db.schema.withSchema('github').dropTable('commit_branches').execute();
  await db.schema
    .withSchema('github')
    .dropTable('repository_branches')
    .execute();
}
