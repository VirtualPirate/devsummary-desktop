import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // NestJS relies on `emitDecoratorMetadata`, which esbuild (Vite's default
    // transformer) does not implement. unplugin-swc reads this package's
    // tsconfig.json by default, picking up experimentalDecorators,
    // emitDecoratorMetadata, and target.
    //
    // It does NOT translate tsconfig's `jsx: react-jsx` into swc's automatic
    // JSX runtime, so src/emails/*.tsx (which import no React binding) compile
    // to bare `React.createElement` and every email render throws
    // "React is not defined". Set the runtime explicitly.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        transform: {
          react: { runtime: 'automatic', importSource: 'react' },
        },
      },
    }),
  ],
  test: {
    include: ['test/e2e/specs/**/*.e2e.spec.ts'],
    globalSetup: ['./test/e2e/global-setup.ts'],
    setupFiles: ['./test/e2e/setup-file.ts'],
    // Forks, not threads: the app opens native handles (two pg pools, pino
    // transport workers, the Temporal native connection) that do not survive
    // worker-thread teardown cleanly.
    pool: 'forks',
    // Vitest 4 removed test.poolOptions; the fork cap is now the top-level
    // maxWorkers (the plan was written against Vitest 3, which spelled this
    // poolOptions.forks.maxForks). There is no minWorkers counterpart.
    maxWorkers: 4,
    // A cold `postgres:18` pull plus the first-run Temporal binary download
    // are both slow. Steady-state setup is a few seconds.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
