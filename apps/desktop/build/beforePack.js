'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { generate: generateNotices } = require('./gen-notices');

/**
 * electron-builder `beforePack` hook — runs once, before electron-builder reads
 * `files` and starts copying things into the app package.
 *
 * Verified against pnpm 10.33.2.
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

  // Attribution first, so the notices copied into the package below describe the
  // dependency tree this build actually ships.
  generateNotices(repoRoot);

  fs.rmSync(target, { recursive: true, force: true });

  // Requires apps/backend/dist and packages/*/dist to already exist — i.e. this
  // must run after `pnpm build`, same as the root "dist" script already does
  // (`pnpm build && pnpm --filter desktop dist`).
  //
  // `--legacy`: pnpm v10 refuses to deploy from a workspace that is not set up
  // for injected dependencies (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE). The flag
  // is pnpm's own escape hatch and keeps the pre-v10 behaviour we want here —
  // copy the workspace deps in rather than hard-link them from the store.
  //
  // `--config.node-linker=hoisted`: deploy still lays the tree out the pnpm way
  // by default — real packages under `node_modules/.pnpm/<name>@<ver>/`, with
  // `node_modules/<name>` a *symlink* to each. That survives being copied beside
  // the app, but not being packed into asar: Electron's archive shim resolves
  // such a link to its target and then reads the target as a file, so the very
  // first `require('@nestjs/core')` dies with
  //
  //   Error: ENOENT, node_modules/.pnpm/@nestjs+core@11.2.1_.../node_modules/
  //   @nestjs/core not found in .../backend.asar
  //
  // The hoisted linker writes one flat tree of real directories instead, which
  // packs and resolves correctly — and, being deduplicated, is smaller too.
  execFileSync(
    'pnpm',
    [
      '--filter',
      'backend',
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      target,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  pruneEscapingSymlinks(target);
};

/**
 * `pnpm deploy` used to leave one symlink pointing back out at the source
 * workspace: `node_modules/.pnpm/node_modules/backend -> ../../../../../backend`,
 * i.e. the deployed package linking to its own repo checkout. Harmless where it
 * is created — the target exists — but once electron-builder copied the tree
 * into the app, those five `..` hops landed outside it and the link dangled.
 * The hoisted linker above no longer produces it; this stays as a guard, because
 * any workspace dep pnpm chooses to link instead of copy would do the same.
 *
 * That is not cosmetic. Code signing walks the whole bundle, and a dangling link
 * aborts the build outright:
 *
 *   ENOENT: no such file or directory, stat '.../Resources/backend/node_modules/
 *   .pnpm/node_modules/backend'
 *
 * And had it resolved, it would have pointed the shipped app at a directory on
 * the build machine. Drop any symlink whose target escapes the deploy root.
 */
function pruneEscapingSymlinks(root) {
  const realRoot = fs.realpathSync(root);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = path.resolve(dir, fs.readlinkSync(full));
        if (target !== realRoot && !target.startsWith(realRoot + path.sep)) {
          fs.rmSync(full, { force: true });
          console.log(`[beforePack] pruned escaping symlink ${path.relative(root, full)}`);
        }
      } else if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(realRoot);
}
