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
  // `--legacy`: pnpm v10 refuses to deploy from a workspace that is not set up
  // for injected dependencies (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE). The flag
  // is pnpm's own escape hatch and keeps the pre-v10 behaviour we want here —
  // copy the workspace deps in rather than hard-link them from the store.
  execFileSync('pnpm', ['--filter', 'backend', 'deploy', '--legacy', '--prod', target], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  pruneEscapingSymlinks(target);
};

/**
 * `pnpm deploy` leaves one symlink pointing back out at the source workspace:
 * `node_modules/.pnpm/node_modules/backend -> ../../../../../backend`, i.e. the
 * deployed package linking to its own repo checkout. Harmless where it is
 * created — the target exists — but once electron-builder copies the tree into
 * `Contents/Resources/backend/`, those five `..` hops land on `Contents/backend`
 * and the link dangles.
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
