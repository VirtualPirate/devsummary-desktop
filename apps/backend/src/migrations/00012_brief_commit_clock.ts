import { Kysely, sql } from 'kysely';

/**
 * `briefs.briefs.commit_clock` — which of git's two dates the brief's commits
 * were selected by, snapshotted on the brief at creation.
 *
 * Selection moves to the **committer** date, so a brief covers what *landed* on
 * the tracked branch during its period — the same clock the ingest high-water
 * mark already uses (GitHub's `since` filters on commit date). While the two
 * disagreed, a rebased branch was fetched, stored and analysed on its committer
 * date and then failed selection on its stale author date, so it landed in *no*
 * brief: the period it belonged to was closed,
 * `briefs_schedule_period_active_unique` blocks a second brief for it, and
 * `claimDue` only walks forward.
 *
 * Existing rows keep `'authored'` — that is exactly the semantics they were
 * generated under, and it is the whole point of the column. `brief_commits`
 * freezes each brief's commit list, but `BriefReportService` re-queries live by
 * period; without the snapshot, every historical report would print totals that
 * contradict the `commit_count` stored on the brief it belongs to.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addColumn('commit_clock', 'text', (col) =>
      col.notNull().defaultTo('authored'),
    )
    .execute();

  // The application maps this column through a closed lookup, so an unexpected
  // value can only arrive by hand-editing a row; the constraint is what stops
  // that from silently selecting nothing.
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addCheckConstraint(
      'briefs_commit_clock_check',
      sql`commit_clock IN ('authored', 'committed')`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropConstraint('briefs_commit_clock_check')
    .execute();
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropColumn('commit_clock')
    .execute();
}
