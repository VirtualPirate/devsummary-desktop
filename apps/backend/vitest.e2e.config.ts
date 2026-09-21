import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** The Jest manual mocks, reused verbatim — see `resolve.alias` below. */
const mock = (file: string) =>
  fileURLToPath(new URL(`./src/__mocks__/${file}`, import.meta.url));

export default defineConfig({
  plugins: [
    // NestJS relies on `emitDecoratorMetadata`, which esbuild (Vite's default
    // transformer) does not implement. unplugin-swc reads this package's
    // tsconfig.json by default, picking up experimentalDecorators,
    // emitDecoratorMetadata, and target.
    swc.vite({ module: { type: 'es6' } }),
  ],
  resolve: {
    // Every network seam, stubbed at the same module boundary the unit suites
    // use. Jest gets there through `moduleNameMapper` in package.json, which
    // Vitest does not read; an alias is the equivalent one-line mechanism and
    // needs no DI override, so the app's own wiring stays under test.
    //
    // Anchored regexes, not bare strings: a string alias for `openai` is a
    // prefix match and would rewrite `openai/helpers/zod` to a path inside the
    // mock file.
    alias: [
      { find: /^@octokit\/core$/, replacement: mock('@octokit/core.ts') },
      {
        find: /^@octokit\/plugin-paginate-rest$/,
        replacement: mock('@octokit/plugin-paginate-rest.ts'),
      },
      { find: /^openai$/, replacement: mock('openai.ts') },
      {
        find: /^openai\/helpers\/zod$/,
        replacement: mock('openai/helpers/zod.ts'),
      },
      // The agent CLIs' one spawn. Aliasing the module rather than
      // `run-cli.ts` keeps that file under test: its credential stripping,
      // stdin write, timeout and kill-grace are real. The fake re-exports
      // everything it does not override, so any other consumer is untouched.
      {
        find: /^node:child_process$/,
        replacement: fileURLToPath(
          new URL('./test/e2e/fakes/child-process.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ['test/e2e/specs/**/*.e2e.spec.ts'],
    setupFiles: ['./test/e2e/setup-file.ts'],
    // No globalSetup: the database is an in-memory PGlite built per file, and
    // an in-memory instance cannot be shared across processes (globalSetup can
    // only hand workers serialisable values). Nothing is left to start once.
    //
    // Forks, not threads: the app opens native handles (the PGlite WASM
    // instance, pino transport workers) that do not survive worker-thread
    // teardown cleanly.
    pool: 'forks',
    // Vitest 4 removed test.poolOptions; the fork cap is now the top-level
    // maxWorkers (the plan was written against Vitest 3, which spelled this
    // poolOptions.forks.maxForks). There is no minWorkers counterpart.
    maxWorkers: 4,
    // The 30 s figure assumed the per-file cost was just ~1.2 s of migration
    // replay into a fresh PGlite. It is not: on an 8-core laptop with 4 forks,
    // cold PGlite plus the Nest bootstrap in `beforeAll` exceeds 30 s and most
    // spec files time out there with zero assertion failures (reproduced on
    // the pre-sync base commit, so it is not a regression from the port).
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
});
