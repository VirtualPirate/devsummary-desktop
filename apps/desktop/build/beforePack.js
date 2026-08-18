'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

/**
 * electron-builder `beforePack` hook — runs once, before electron-builder reads
 * `files` and starts copying things into the app package.
 *
 * UNVERIFIED. See docs/receipts/PHASE-10.md and electron-builder.yml's header
 * comment. Never executed; expect to debug this the first time `pnpm dist` runs
 * for real (pnpm version skew, workspace protocol resolution, etc. are all
 * plausible failure points).
 *
 * Why this exists: pnpm's default node_modules layout is a symlink forest into a
 * shared content-addressed store, which electron-builder's own dependency-pruning
 * walker does not understand — it would either miss transitive deps or asar a
 * tree of dangling symlinks. `pnpm deploy` is pnpm's own answer to exactly this
 * problem: given a workspace package, it materializes a real, non-symlinked,
 * production-only node_modules (workspace-protocol deps like @launchstack/core
 * get inlined as plain copies, not symlinks) into a target directory, alongside
 * whatever that package's own `"files"` allowlist says to include. Backend's
 * package.json already declares `"files": ["dist"]`, so the deploy output is
 * exactly `{ dist/, node_modules/, package.json }` — nothing left to filter.
 */
module.exports = async function beforePack() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const target = path.resolve(__dirname, '..', '.backend-deploy');

  fs.rmSync(target, { recursive: true, force: true });

  // Requires apps/backend/dist and packages/*/dist to already exist — i.e. this
  // must run after `pnpm build`, same as the root "dist" script already does
  // (`pnpm build && pnpm --filter desktop dist`).
  execFileSync('pnpm', ['--filter', 'backend', 'deploy', '--prod', target], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
};
