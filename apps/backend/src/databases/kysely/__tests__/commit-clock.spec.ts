import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { commitClockColumn, commitClockRef } from '../commit-clock';

/**
 * Compiles like the app does — `CamelCasePlugin` included, since that is what
 * would silently rewrite an identifier out from under us.
 */
const db = new Kysely<any>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (i: Kysely<any>) => new PostgresIntrospector(i),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
  plugins: [new CamelCasePlugin()],
});

describe('commit clock → column', () => {
  it('maps each clock to its own column, both spellings', () => {
    expect(commitClockColumn('authored')).toBe('authoredAt');
    expect(commitClockColumn('committed')).toBe('committedAt');
    expect(commitClockColumn('landed')).toBe('landedAt');
    // The fragment that actually reaches Postgres: quoted, table-qualified, and
    // untouched by the plugin.
    expect(commitClockRef('authored').compile(db).sql).toBe(
      '"c"."authored_at"',
    );
    expect(commitClockRef('committed').compile(db).sql).toBe(
      '"c"."committed_at"',
    );
    expect(commitClockRef('landed').compile(db).sql).toBe('"c"."landed_at"');
  });

  // The point of the closed switch: a clock out of a hand-edited row must blow
  // up rather than be interpolated into SQL or bound to a nonexistent column.
  it.each([
    'authored_at',
    'COMMITTED',
    'landing',
    '',
    "authored'; drop table briefs.briefs",
  ])('rejects the junk clock %p instead of composing SQL', (junk) => {
    expect(() => commitClockColumn(junk as never)).toThrow(
      /unknown commit clock/,
    );
    expect(() => commitClockRef(junk as never)).toThrow(/unknown commit clock/);
  });
});
