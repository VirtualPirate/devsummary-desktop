import { Kysely, sql } from 'kysely';

/**
 * Backfill `github.collaborators` from commit authors.
 *
 * Until now the table was populated only from GitHub's
 * `/repos/:owner/:repo/collaborators`, which returns the grants made *directly*
 * on a repository. A GitHub App installation cannot see inherited access — on a
 * private fork, the permissions everyone actually holds come from the parent
 * repository, so the endpoint answers with a near-empty list for a repo with
 * thousands of commits. The people with all the work were therefore missing
 * from the table and unreachable as a brief or team scope.
 *
 * Every commit payload already carries its author's full user object (the same
 * shape the collaborators endpoint returns) and is covered by `contents: read`,
 * so the rows can be recovered from data already ingested — no API calls.
 *
 * `distinct on ... order by committed_at desc` takes each author's most recent
 * appearance, so a rename lands as the current login rather than an old one.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    insert into github.collaborators (
      github_user_id,
      login,
      node_id,
      avatar_url,
      html_url,
      type,
      site_admin,
      raw
    )
    select distinct on (c.author_github_user_id)
      c.author_github_user_id,
      c.raw -> 'author' ->> 'login',
      c.raw -> 'author' ->> 'node_id',
      c.raw -> 'author' ->> 'avatar_url',
      c.raw -> 'author' ->> 'html_url',
      c.raw -> 'author' ->> 'type',
      coalesce((c.raw -> 'author' ->> 'site_admin')::boolean, false),
      c.raw -> 'author'
    from github.commits c
    where c.author_github_user_id is not null
      and c.deleted_at is null
      and c.raw -> 'author' ->> 'login' is not null
    order by c.author_github_user_id, c.committed_at desc
    on conflict (github_user_id) do nothing
  `.execute(db);
}

/**
 * Deliberately a no-op. The inserted rows are indistinguishable from ones the
 * collaborator sync would have written, and `briefs.brief_schedules` /
 * `briefs.briefs` reference collaborators by id — deleting them would cascade
 * into schedules that have nothing to do with this migration.
 */
export async function down(): Promise<void> {
  // intentionally empty
}
