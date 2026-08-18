import { Kysely, sql } from 'kysely';

/**
 * Initial schema: organizations (public), Better Auth (auth), GitHub ingestion
 * (github), Slack (slack), and briefs (briefs).
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await createAuthSchema(db);
  await createOrganizations(db);
  await createGithubSchema(db);
  await createSlackSchema(db);
  await createBriefsSchema(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Dropping these schemas takes their tables and enum types with them.
  await db.schema.dropSchema('briefs').ifExists().cascade().execute();
  await db.schema.dropSchema('slack').ifExists().cascade().execute();
  await db.schema.dropSchema('github').ifExists().cascade().execute();

  for (const table of [
    'organization_invites',
    'organization_members',
    'organizations',
  ]) {
    await db.schema.dropTable(table).ifExists().cascade().execute();
  }
  for (const type of ['invite_role', 'invite_status', 'organization_role']) {
    await db.schema.dropType(type).ifExists().execute();
  }

  await db.schema.dropSchema('auth').ifExists().cascade().execute();
}

// ---------------------------------------------------------------------------
// auth — Better Auth owns these tables. Timestamps are deliberately naive
// (`timestamp`, no time zone) to match what Better Auth reads and writes.
// ---------------------------------------------------------------------------

async function createAuthSchema(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('auth').ifNotExists().execute();

  await db.schema
    .withSchema('auth')
    .createTable('user')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('email_verified', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('image', 'text')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('user_email_unique', ['email'])
    .execute();

  await db.schema
    .withSchema('auth')
    .createTable('session')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('expires_at', 'timestamp', (col) => col.notNull())
    .addColumn('token', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) => col.notNull())
    .addColumn('ip_address', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('auth.user.id').onDelete('cascade'),
    )
    .addUniqueConstraint('session_token_unique', ['token'])
    .execute();

  await db.schema
    .withSchema('auth')
    .createTable('account')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('account_id', 'text', (col) => col.notNull())
    .addColumn('provider_id', 'text', (col) => col.notNull())
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('auth.user.id').onDelete('cascade'),
    )
    .addColumn('access_token', 'text')
    .addColumn('refresh_token', 'text')
    .addColumn('id_token', 'text')
    .addColumn('access_token_expires_at', 'timestamp')
    .addColumn('refresh_token_expires_at', 'timestamp')
    .addColumn('scope', 'text')
    .addColumn('password', 'text')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) => col.notNull())
    .execute();

  await db.schema
    .withSchema('auth')
    .createTable('verification')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('identifier', 'text', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamp', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .withSchema('auth')
    .createIndex('session_user_id_idx')
    .on('session')
    .column('user_id')
    .execute();

  await db.schema
    .withSchema('auth')
    .createIndex('account_user_id_idx')
    .on('account')
    .column('user_id')
    .execute();

  await db.schema
    .withSchema('auth')
    .createIndex('verification_identifier_idx')
    .on('verification')
    .column('identifier')
    .execute();
}

// ---------------------------------------------------------------------------
// public — organizations, membership, invites
// ---------------------------------------------------------------------------

async function createOrganizations(db: Kysely<any>): Promise<void> {
  await db.schema
    .createType('organization_role')
    .asEnum(['owner', 'admin', 'viewer'])
    .execute();
  await db.schema
    .createType('invite_role')
    .asEnum(['admin', 'viewer'])
    .execute();
  await db.schema
    .createType('invite_status')
    .asEnum(['pending', 'accepted', 'revoked', 'expired'])
    .execute();

  await db.schema
    .createTable('organizations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull())
    .addColumn('owner_id', 'text', (col) =>
      col.notNull().references('auth.user.id').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('organization_members')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('organizations.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('auth.user.id').onDelete('cascade'),
    )
    .addColumn('role', sql`organization_role`, (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('organization_invites')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('organizations.id').onDelete('cascade'),
    )
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('role', sql`invite_role`, (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull())
    .addColumn('status', sql`invite_status`, (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('invited_by_user_id', 'text', (col) =>
      col.references('auth.user.id').onDelete('set null'),
    )
    .addColumn('accepted_by_user_id', 'text', (col) =>
      col.references('auth.user.id').onDelete('set null'),
    )
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('organizations_slug_unique')
    .unique()
    .on('organizations')
    .column('slug')
    .execute();

  await db.schema
    .createIndex('organizations_owner_id_unique')
    .unique()
    .on('organizations')
    .column('owner_id')
    .execute();

  await db.schema
    .createIndex('organization_members_org_user_unique')
    .unique()
    .on('organization_members')
    .columns(['organization_id', 'user_id'])
    .execute();

  await db.schema
    .createIndex('organization_members_user_idx')
    .on('organization_members')
    .column('user_id')
    .execute();

  await db.schema
    .createIndex('organization_invites_token_hash_unique')
    .unique()
    .on('organization_invites')
    .column('token_hash')
    .execute();

  // One live invite per email per org; revoked/expired rows may accumulate.
  await db.schema
    .createIndex('organization_invites_pending_org_email_unique')
    .unique()
    .on('organization_invites')
    .columns(['organization_id', 'email'])
    .where(sql<boolean>`status = 'pending'`)
    .execute();

  await db.schema
    .createIndex('organization_invites_email_idx')
    .on('organization_invites')
    .column('email')
    .execute();

  await db.schema
    .createIndex('organization_invites_organization_idx')
    .on('organization_invites')
    .column('organization_id')
    .execute();
}

// ---------------------------------------------------------------------------
// github — App installations, repos, commits, AI analyses, collaborators
// ---------------------------------------------------------------------------

async function createGithubSchema(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('github').execute();

  await db.schema
    .withSchema('github')
    .createType('account_type')
    .asEnum(['User', 'Organization'])
    .execute();

  await db.schema
    .withSchema('github')
    .createType('commit_type')
    .asEnum([
      'fix',
      'feature',
      'optimization',
      'refactor',
      'docs',
      'test',
      'chore',
    ])
    .execute();

  await db.schema
    .withSchema('github')
    .createType('commit_analysis_status')
    .asEnum(['analyzed', 'skipped_merge', 'skipped_empty', 'failed'])
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('installations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('public.organizations.id').onDelete('cascade'),
    )
    .addColumn('github_installation_id', 'bigint', (col) => col.notNull())
    .addColumn('github_account_id', 'bigint', (col) => col.notNull())
    .addColumn('github_account_login', 'text', (col) => col.notNull())
    .addColumn('github_account_type', sql`github.account_type`, (col) =>
      col.notNull(),
    )
    .addColumn('github_account_avatar_url', 'text')
    .addColumn('target_type', 'text', (col) => col.notNull())
    .addColumn('suspended_at', 'timestamptz')
    .addColumn('connected_by_user_id', 'text', (col) =>
      col.references('auth.user.id').onDelete('set null'),
    )
    .addColumn('raw', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('repositories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('installation_id', 'uuid', (col) =>
      col.notNull().references('github.installations.id').onDelete('cascade'),
    )
    .addColumn('github_repo_id', 'bigint', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('private', 'boolean', (col) => col.notNull())
    .addColumn('raw', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('commits')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('repository_id', 'uuid', (col) =>
      col.notNull().references('github.repositories.id').onDelete('cascade'),
    )
    .addColumn('sha', 'varchar(40)', (col) => col.notNull())
    .addColumn('parent_count', 'integer', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('author_github_user_id', 'bigint')
    .addColumn('author_github_login', 'text')
    .addColumn('author_name', 'text', (col) => col.notNull())
    .addColumn('author_email', 'text', (col) => col.notNull())
    .addColumn('committer_github_user_id', 'bigint')
    .addColumn('committer_github_login', 'text')
    .addColumn('committer_name', 'text', (col) => col.notNull())
    .addColumn('committer_email', 'text', (col) => col.notNull())
    .addColumn('authored_at', 'timestamptz', (col) => col.notNull())
    .addColumn('committed_at', 'timestamptz', (col) => col.notNull())
    .addColumn('raw', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('commit_analyses')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('commit_id', 'uuid', (col) =>
      col.notNull().references('github.commits.id').onDelete('cascade'),
    )
    .addColumn('commit_type', sql`github.commit_type`)
    .addColumn('summary', 'text')
    .addColumn('changes', 'jsonb')
    .addColumn('status', sql`github.commit_analysis_status`, (col) =>
      col.notNull(),
    )
    .addColumn('failure_reason', 'text')
    .addColumn('model', 'text')
    .addColumn('prompt_tokens', 'integer')
    .addColumn('completion_tokens', 'integer')
    .addColumn('diff_chars_sent', 'integer')
    .addColumn('diff_was_truncated', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('additions', 'integer')
    .addColumn('deletions', 'integer')
    .addColumn('analyzed_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  // PK is the GitHub delivery UUID — that is what makes webhook receipt idempotent.
  await db.schema
    .withSchema('github')
    .createTable('webhook_events')
    .addColumn('id', 'varchar(64)', (col) => col.primaryKey())
    .addColumn('event', 'varchar(64)')
    .addColumn('raw', 'jsonb', (col) => col.notNull())
    .addColumn('state', 'varchar(32)', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('collaborators')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('github_user_id', 'bigint', (col) => col.notNull())
    .addColumn('login', 'text', (col) => col.notNull())
    .addColumn('node_id', 'text')
    .addColumn('avatar_url', 'text')
    .addColumn('html_url', 'text')
    .addColumn('type', 'text')
    .addColumn('site_admin', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('raw', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('github')
    .createTable('repository_collaborators')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('repository_id', 'uuid', (col) =>
      col.notNull().references('github.repositories.id').onDelete('cascade'),
    )
    .addColumn('collaborator_id', 'uuid', (col) =>
      col.notNull().references('github.collaborators.id').onDelete('cascade'),
    )
    .addColumn('role_name', 'text', (col) => col.notNull())
    .addColumn('permission_admin', 'boolean', (col) => col.notNull())
    .addColumn('permission_maintain', 'boolean', (col) => col.notNull())
    .addColumn('permission_push', 'boolean', (col) => col.notNull())
    .addColumn('permission_triage', 'boolean', (col) => col.notNull())
    .addColumn('permission_pull', 'boolean', (col) => col.notNull())
    .addColumn('raw', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('installations_github_installation_id_unique')
    .unique()
    .on('installations')
    .column('github_installation_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('installations_organization_idx')
    .on('installations')
    .column('organization_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('repositories_installation_repo_unique')
    .unique()
    .on('repositories')
    .columns(['installation_id', 'github_repo_id'])
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('repositories_installation_idx')
    .on('repositories')
    .column('installation_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('commits_repo_sha_unique')
    .unique()
    .on('commits')
    .columns(['repository_id', 'sha'])
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('commits_repo_authored_at_idx')
    .on('commits')
    .columns(['repository_id', 'authored_at'])
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('commits_author_authored_at_idx')
    .on('commits')
    .columns(['author_github_user_id', 'authored_at'])
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('commit_analyses_commit_unique')
    .unique()
    .on('commit_analyses')
    .column('commit_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('collaborators_github_user_id_unique')
    .unique()
    .on('collaborators')
    .column('github_user_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('collaborators_login_idx')
    .on('collaborators')
    .column('login')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('repo_collaborators_repo_collab_unique')
    .unique()
    .on('repository_collaborators')
    .columns(['repository_id', 'collaborator_id'])
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('repo_collaborators_collaborator_idx')
    .on('repository_collaborators')
    .column('collaborator_id')
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('repo_collaborators_active_repo_idx')
    .on('repository_collaborators')
    .column('repository_id')
    .where(sql<boolean>`deleted_at IS NULL`)
    .execute();
}

// ---------------------------------------------------------------------------
// slack — one live bot installation per organization
// ---------------------------------------------------------------------------

async function createSlackSchema(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('slack').execute();

  await db.schema
    .withSchema('slack')
    .createTable('installations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('public.organizations.id').onDelete('cascade'),
    )
    .addColumn('access_token', 'text', (col) => col.notNull())
    .addColumn('raw', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('slack')
    .createIndex('slack_installations_org_active_unique')
    .unique()
    .on('installations')
    .column('organization_id')
    .where(sql<boolean>`deleted_at IS NULL`)
    .execute();

  await db.schema
    .withSchema('slack')
    .createIndex('slack_installations_organization_idx')
    .on('installations')
    .column('organization_id')
    .execute();
}

// ---------------------------------------------------------------------------
// briefs — projects/teams groupings, schedules, generated briefs
// ---------------------------------------------------------------------------

async function createBriefsSchema(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('briefs').execute();

  await db.schema
    .withSchema('briefs')
    .createType('cadence_type')
    .asEnum(['daily', 'weekly', 'monthly'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createType('scope_type')
    .asEnum(['project', 'team', 'collaborator', 'repository'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createType('status')
    .asEnum(['pending', 'generating', 'generated', 'delivered', 'failed'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('projects')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('public.organizations.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(120)', (col) => col.notNull())
    .addColumn('description', 'varchar(500)')
    .addColumn('color', 'varchar(16)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('project_repositories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('briefs.projects.id').onDelete('cascade'),
    )
    .addColumn('repository_id', 'uuid', (col) =>
      col.notNull().references('github.repositories.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('teams')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('public.organizations.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(120)', (col) => col.notNull())
    .addColumn('description', 'varchar(500)')
    .addColumn('color', 'varchar(16)')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('team_collaborators')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('team_id', 'uuid', (col) =>
      col.notNull().references('briefs.teams.id').onDelete('cascade'),
    )
    .addColumn('collaborator_id', 'uuid', (col) =>
      col.notNull().references('github.collaborators.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('brief_schedules')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('public.organizations.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(200)', (col) => col.notNull())
    .addColumn('cadence_type', sql`briefs.cadence_type`, (col) => col.notNull())
    .addColumn('cadence_time', 'time', (col) => col.notNull())
    .addColumn('cadence_day_of_week', 'smallint')
    .addColumn('cadence_day_of_month', 'smallint')
    .addColumn('timezone', 'text', (col) => col.notNull().defaultTo('UTC'))
    .addColumn('scope_type', sql`briefs.scope_type`, (col) => col.notNull())
    .addColumn('scope_project_id', 'uuid', (col) =>
      col.references('briefs.projects.id').onDelete('cascade'),
    )
    .addColumn('scope_team_id', 'uuid', (col) =>
      col.references('briefs.teams.id').onDelete('cascade'),
    )
    .addColumn('scope_collaborator_id', 'uuid', (col) =>
      col.references('github.collaborators.id').onDelete('cascade'),
    )
    .addColumn('scope_repository_id', 'uuid', (col) =>
      col.references('github.repositories.id').onDelete('cascade'),
    )
    .addColumn('paused', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('next_run_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_sent_at', 'timestamptz')
    .addColumn('email_recipients', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn('slack_installation_id', 'uuid', (col) =>
      col.references('slack.installations.id').onDelete('set null'),
    )
    .addColumn('slack_channel_id', 'text')
    .addColumn('created_by_member_id', 'text', (col) =>
      col.references('auth.user.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint(
      'brief_schedules_cadence_day_of_week_check',
      sql`cadence_day_of_week IS NULL OR (cadence_day_of_week BETWEEN 0 AND 6)`,
    )
    .addCheckConstraint(
      'brief_schedules_cadence_day_of_month_check',
      sql`cadence_day_of_month IS NULL OR (cadence_day_of_month BETWEEN 1 AND 31)`,
    )
    // Exactly one scope FK must be set, and it must be the one scope_type names.
    .addCheckConstraint(
      'brief_schedules_scope_xor',
      sql`(
        (CASE WHEN scope_project_id      IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN scope_team_id         IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN scope_collaborator_id IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN scope_repository_id   IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1`,
    )
    .addCheckConstraint(
      'brief_schedules_scope_type_matches',
      sql`(
        (scope_type = 'project'      AND scope_project_id      IS NOT NULL) OR
        (scope_type = 'team'         AND scope_team_id         IS NOT NULL) OR
        (scope_type = 'collaborator' AND scope_collaborator_id IS NOT NULL) OR
        (scope_type = 'repository'   AND scope_repository_id   IS NOT NULL)
      )`,
    )
    // Slack delivery needs both the installation and the channel, or neither.
    .addCheckConstraint(
      'brief_schedules_slack_pair',
      sql`(slack_installation_id IS NULL AND slack_channel_id IS NULL)
        OR (slack_installation_id IS NOT NULL AND slack_channel_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('briefs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('public.organizations.id').onDelete('cascade'),
    )
    .addColumn('brief_schedule_id', 'uuid', (col) =>
      col.references('briefs.brief_schedules.id').onDelete('set null'),
    )
    .addColumn('scope_type', sql`briefs.scope_type`, (col) => col.notNull())
    .addColumn('scope_project_id', 'uuid', (col) =>
      col.references('briefs.projects.id').onDelete('set null'),
    )
    .addColumn('scope_team_id', 'uuid', (col) =>
      col.references('briefs.teams.id').onDelete('set null'),
    )
    .addColumn('scope_collaborator_id', 'uuid', (col) =>
      col.references('github.collaborators.id').onDelete('set null'),
    )
    .addColumn('scope_repository_id', 'uuid', (col) =>
      col.references('github.repositories.id').onDelete('set null'),
    )
    .addColumn('title', 'varchar(200)', (col) => col.notNull().defaultTo(''))
    .addColumn('brief_info_title', 'varchar(300)', (col) =>
      col.notNull().defaultTo(''),
    )
    .addColumn('summary', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('period_start', 'timestamptz', (col) => col.notNull())
    .addColumn('period_end', 'timestamptz', (col) => col.notNull())
    .addColumn('contributor_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('commit_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', sql`briefs.status`, (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('failure_reason', 'text')
    .addColumn('model', 'text')
    .addColumn('prompt_tokens', 'integer')
    .addColumn('completion_tokens', 'integer')
    .addColumn('delivery_emails', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn('delivery_slack_channel_id', 'text')
    .addColumn('generated_at', 'timestamptz')
    .addColumn('delivered_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createTable('brief_commits')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('brief_id', 'uuid', (col) =>
      col.notNull().references('briefs.briefs.id').onDelete('cascade'),
    )
    .addColumn('commit_id', 'uuid', (col) =>
      col.references('github.commits.id').onDelete('set null'),
    )
    .addColumn('sha', 'varchar(40)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('projects_organization_idx')
    .on('projects')
    .column('organization_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('projects_org_name_unique')
    .unique()
    .on('projects')
    .columns(['organization_id', 'name'])
    .where(sql<boolean>`deleted_at IS NULL`)
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('project_repositories_pair_unique')
    .unique()
    .on('project_repositories')
    .columns(['project_id', 'repository_id'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('project_repositories_project_idx')
    .on('project_repositories')
    .column('project_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('project_repositories_repository_idx')
    .on('project_repositories')
    .column('repository_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('teams_organization_idx')
    .on('teams')
    .column('organization_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('teams_org_name_unique')
    .unique()
    .on('teams')
    .columns(['organization_id', 'name'])
    .where(sql<boolean>`deleted_at IS NULL`)
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('team_collaborators_pair_unique')
    .unique()
    .on('team_collaborators')
    .columns(['team_id', 'collaborator_id'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('team_collaborators_team_idx')
    .on('team_collaborators')
    .column('team_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('team_collaborators_collaborator_idx')
    .on('team_collaborators')
    .column('collaborator_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('brief_schedules_organization_idx')
    .on('brief_schedules')
    .column('organization_id')
    .execute();

  // Drives the dispatcher's FOR UPDATE SKIP LOCKED claim query.
  await db.schema
    .withSchema('briefs')
    .createIndex('brief_schedules_next_run_active_idx')
    .on('brief_schedules')
    .column('next_run_at')
    .where(sql<boolean>`paused = false AND deleted_at IS NULL`)
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('briefs_organization_created_idx')
    .on('briefs')
    .columns(['organization_id', 'created_at'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('briefs_organization_period_end_idx')
    .on('briefs')
    .columns(['organization_id', 'period_end'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('briefs_schedule_idx')
    .on('briefs')
    .column('brief_schedule_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('briefs_org_scope_idx')
    .on('briefs')
    .columns([
      'organization_id',
      'scope_type',
      'scope_project_id',
      'scope_team_id',
      'scope_collaborator_id',
      'scope_repository_id',
    ])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('brief_commits_brief_commit_unique')
    .unique()
    .on('brief_commits')
    .columns(['brief_id', 'commit_id'])
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('brief_commits_brief_idx')
    .on('brief_commits')
    .column('brief_id')
    .execute();

  await db.schema
    .withSchema('briefs')
    .createIndex('brief_commits_commit_idx')
    .on('brief_commits')
    .column('commit_id')
    .execute();
}
