'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { generate: generateNotices } = require('./gen-notices');

/**
 * Windows ships pnpm as `pnpm.cmd`, and execFile refuses to spawn a .cmd at all
 * since Node's CVE-2024-27980 fix — `spawnSync pnpm ENOENT`, which is what the
 * windows-latest runner hit here. The same hazard is already handled a layer up
 * in AgentCliDetector; packaging had never been run on Windows to find it.
 */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

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

  ensureElectronDist();

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
    PNPM,
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
 * electron@43.4.0's published package.json has no `scripts` field, so nothing
 * ever runs the install.js sitting beside it: a fresh checkout gets
 * node_modules/electron with no dist/ directory at all. electron-builder does
 * not care — it downloads its own Electron to pack — but the
 * LICENSES.chromium.html that `extraResources` ships is read out of that dist,
 * and a missing extraResources source is a *warning*:
 *
 *   • file source doesn't exist  from=.../node_modules/electron/dist/LICENSES.chromium.html
 *
 * so the app packages successfully with no Chromium attribution in it. Every
 * build on the machine that has had a populated dist/ since its first install
 * passed; the first clean runner caught it.
 *
 * install.js is electron's own downloader (@electron/get, honours
 * ELECTRON_CACHE) and short-circuits on isInstalled(), so it is safe to run
 * unconditionally — the existsSync just keeps the already-installed case free.
 */
function ensureElectronDist() {
  // Same path electron-builder.yml's extraResources entry resolves, so the two
  // cannot drift apart.
  const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron');
  const notices = path.join(electronDir, 'dist', 'LICENSES.chromium.html');

  // Gate on the directory, not on the file: install.js decides for itself via
  // isInstalled(), which looks for the binary, so handing it a dist that exists
  // but is missing this one file would be a no-op and the throw below would
  // blame the downloader for something it was never asked to fix.
  if (!fs.existsSync(path.join(electronDir, 'dist'))) {
    console.log('[beforePack] electron dist absent — running electron/install.js');
    execFileSync(process.execPath, [path.join(electronDir, 'install.js')], {
      cwd: electronDir,
      stdio: 'inherit',
    });
  }

  // Asserted either way. Shipping without Chromium's notices is the failure this
  // function exists to prevent, and it is invisible in a passing build.
  if (!fs.existsSync(notices)) {
    throw new Error(
      `[beforePack] ${notices} is missing — electron-builder would package without ` +
        "Chromium's notices rather than fail",
    );
  }
}

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
