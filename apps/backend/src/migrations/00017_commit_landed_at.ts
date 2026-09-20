import { Kysely, sql } from 'kysely';

/**
 * `github.commits.landed_at` — when this commit first appeared on the branch
 * DevSummary reads, plus a third `briefs.briefs.commit_clock` member that
 * selects on it.
 *
 * Git carries two dates and neither answers the question a brief asks. The
 * author date is when the work was written; the committer date is when the
 * commit object was last rewritten. `00012` moved selection to the committer
 * date because rebase and squash merges rewrite it to the merge, which put a
 * long-lived branch's work in the period it actually shipped.
 *
 * A plain merge commit — GitHub's default "Create a merge commit", `git merge
 * --no-ff` — rewrites nothing. A commit written three weeks ago and merged
 * today keeps both of its three-week-old dates, so it is selected into a period
 * whose brief was generated and emailed weeks ago and appears in none: the
 * period is closed, `briefs_schedule_period_active_unique` blocks a second brief
 * for it, and `claimDue` only walks forward. That is the same failure `00012`
 * fixed for the rewriting merge strategies, still open for the default one.
 *
 * No git timestamp can close it, because the missing fact is not a property of
 * the commit — it is when *we* first saw it on the tracked branch. That is
 * observed at ingest and recorded here.
 *
 * Existing rows are backfilled to `committed_at`, which is exactly what they
 * were selected on before, so every brief written under the `'committed'` clock
 * keeps reporting the set behind its own stored `commit_count`. Existing briefs
 * also keep their snapshotted clock; only briefs created from here on are
 * stamped `'landed'`.
 *
 * The `now()` default is for correctness under concurrency, not for the app: the
 * column is added before the deploy that writes it, so an insert from the old
 * code during the rollout still gets a sane value rather than failing the NOT
 * NULL.
 *
 * No index. `'committed'` has run unindexed since `00012` on the strength of
 * `commits_repo_authored_at_idx`'s `repository_id` prefix, and this clock has
 * the same access path — add one when a brief query actually shows up slow.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('github')
    .alterTable('commits')
    .addColumn('landed_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`update "github"."commits" set "landed_at" = "committed_at"`.execute(
    db,
  );

  // Recreated rather than widened in place — Postgres has no ALTER for a check
  // constraint's expression.
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropConstraint('briefs_commit_clock_check')
    .execute();
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addCheckConstraint(
      'briefs_commit_clock_check',
      sql`commit_clock IN ('authored', 'committed', 'landed')`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Briefs stamped with the new clock have to be re-stamped before the narrower
  // constraint goes back on, or adding it fails. `'committed'` is the closest
  // surviving clock and the one those briefs would have had without this
  // migration.
  await sql`update "briefs"."briefs" set "commit_clock" = 'committed' where "commit_clock" = 'landed'`.execute(
    db,
  );

  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropConstraint('briefs_commit_clock_check')
    .execute();
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addCheckConstraint(
      'briefs_commit_clock_check',
      sql`commit_clock IN ('authored', 'committed')`,
    )
    .execute();

  await db.schema
    .withSchema('github')
    .alterTable('commits')
    .dropColumn('landed_at')
    .execute();
}
