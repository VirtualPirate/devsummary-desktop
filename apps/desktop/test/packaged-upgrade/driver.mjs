// "Upgrade that install to the next build and confirm the data survived" —
// R7's backup-before-migrate path on a *packaged* install, which until this ran
// had only ever been exercised on macOS, from a dev build.
//
// Two real .app bundles out of two real dmgs, launched in order against one
// userData directory:
//
//   vN    the shipped 16 migrations. Creates the database; a marker row is then
//         written into it, standing in for the user's data.
//   vN+1  one more migration (`00017_r7_packaged_probe`). Must back the
//         directory up to `data.bak`, apply it, and leave the marker row alone.
//
// Nothing here is stubbed: these are the binaries electron-builder produced, run
// from a directory that has never held them.
//
//   node apps/desktop/test/packaged-upgrade/driver.mjs <vN.dmg> <vN+1.dmg>
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const require = createRequire(join(repo, 'apps/backend/package.json'));
const { PGlite } = require('@electric-sql/pglite');

const [vnDmg, vnextDmg] = process.argv.slice(2);
if (!vnDmg || !vnextDmg) throw new Error('usage: driver.mjs <vN.dmg> <vN+1.dmg>');

/** A cold launch reached its first backend log record in 8.4 s in §7; a launch
 *  that also copies a 40 MB data directory has room inside this. */
const LAUNCH_TIMEOUT_MS = 180_000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (file, args) => execFileSync(file, args, { encoding: 'utf8' });

const scratch = await mkdtemp(join(tmpdir(), 'devsummary-upgrade-'));
const installDir = join(scratch, 'Applications');
const userData = join(scratch, 'userData');
await mkdir(installDir, { recursive: true });
await mkdir(userData, { recursive: true });
console.log(`scratch: ${scratch}`);

const results = { scratch, userData, steps: [] };

/** Copy the .app out of a dmg into a directory that has never held it — the
 *  point of §1's "launch the copy installed from the dmg", not the build tree. */
async function install(dmg) {
  const out = sh('hdiutil', ['attach', dmg, '-nobrowse', '-readonly']);
  const mount = out.trim().split('\n').pop().split('\t').pop().trim();
  try {
    const app = (await readdir(mount)).find((f) => f.endsWith('.app'));
    if (!app) throw new Error(`no .app inside ${dmg}`);
    await rm(join(installDir, app), { recursive: true, force: true });
    // `ditto` rather than `cp -R`: it preserves the code signature's extended
    // attributes, and a broken signature is a different failure than the one
    // under test.
    sh('ditto', [join(mount, app), join(installDir, app)]);
    return join(installDir, app);
  } finally {
    sh('hdiutil', ['detach', mount, '-force']);
  }
}

const logDir = join(userData, 'logs');
async function readLog() {
  const files = (await readdir(logDir).catch(() => []))
    .filter((f) => f.startsWith('app.log'))
    .sort();
  const texts = await Promise.all(
    files.map((f) => readFile(join(logDir, f), 'utf8').catch(() => '')),
  );
  return texts.join('');
}

/**
 * Launch and wait for the backend to say it is done with migrations. The shell
 * is left running until then and killed after — `app.quit()` needs a window to
 * ask, and this asserts against the log, the database and the filesystem rather
 * than the UI. (§7: Playwright cannot drive a hardened-runtime signed build; the
 * CDP handshake hangs by design.)
 */
async function launch(appPath, label) {
  const bin = join(appPath, 'Contents/MacOS/DevSummary');
  if (!existsSync(bin)) throw new Error(`no executable at ${bin}`);
  // Only the records this launch writes. The log is appended to across launches,
  // so matching the whole file made vN+1 "ready" on vN's own
  // `applied 16 migration(s)` the instant it started — and the app was killed
  // eight seconds into a boot that had not reached the migrator yet.
  const before = (await readLog()).length;
  const started = Date.now();
  const child = spawn(bin, [`--user-data-dir=${userData}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (b) => {
    stderr += b.toString();
  });
  child.stdout.on('data', () => {});

  let log = '';
  let ready = false;
  while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
    await delay(1000);
    log = (await readLog()).slice(before);
    // Nest coming up is the signal, not the migrator: it is the last thing in
    // the boot and it only happens *after* `openMigratedDatabase` has returned,
    // so it cannot be reached with a migration still in flight.
    if (/Nest application successfully started/.test(log)) {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
  }
  if (ready) await delay(3000);
  // Give the shell time to take the backend's PGlite down with it. A SIGKILL
  // straight away leaves the cluster to recover from WAL on the next boot,
  // which works but is not the upgrade being tested.
  child.kill('SIGTERM');
  await delay(6000);
  child.kill('SIGKILL');
  await delay(2000);

  const step = {
    label,
    app: appPath,
    ms: Date.now() - started,
    ready,
    exitCode: child.exitCode,
    migrationLines: log
      .split('\n')
      .filter((l) => /migration|backed up|up to date/.test(l))
      .map((l) => {
        try {
          return JSON.parse(l).msg;
        } catch {
          return l.slice(0, 160);
        }
      }),
    stderr: stderr.slice(-800),
  };
  results.steps.push(step);
  console.log(`${label}: ready=${ready} in ${step.ms} ms`);
  for (const line of step.migrationLines) console.log(`    ${line}`);
  if (!ready) throw new Error(`${label} never finished migrating — see results.json`);
  return step;
}

const q = async (sql) => {
  const db = new PGlite(join(userData, 'data'));
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.close();
  }
};

// ---- vN: a fresh install, then "the user's data" ----------------------------
const vn = await install(vnDmg);
await launch(vn, 'vN');

await q(
  "insert into local_settings (key, value) values ('r7_marker', '\"survived\"'::jsonb) on conflict (key) do update set value = excluded.value",
);
results.markerBefore = await q("select value from local_settings where key = 'r7_marker'");
results.migrationsBefore = await q('select name from kysely_migration order by name');
console.log(`marker written, ${results.migrationsBefore.length} migrations before`);

// ---- vN+1: the upgrade ------------------------------------------------------
const vnext = await install(vnextDmg);
await launch(vnext, 'vN+1');

results.backupExists = existsSync(join(userData, 'data.bak'));
results.backupIsRealCluster = existsSync(join(userData, 'data.bak', 'PG_VERSION'));
results.migrationsAfter = await q('select name from kysely_migration order by name');
results.markerAfter = await q("select value from local_settings where key = 'r7_marker'");
results.probeRows = await q('select id from r7_packaged_probe order by id');
// The backup has to be the *pre-migration* state, or it is not a rollback point.
const bak = new PGlite(join(userData, 'data.bak'));
results.backup = {
  migrations: (await bak.query('select count(*)::int as n from kysely_migration')).rows,
  marker: (await bak.query("select value from local_settings where key = 'r7_marker'"))
    .rows,
  probeTable: (
    await bak.query(
      "select to_regclass('public.r7_packaged_probe') is not null as present",
    )
  ).rows,
};
await bak.close();

const checks = [
  ['backup directory created', results.backupExists],
  ['backup is a real PGlite cluster', results.backupIsRealCluster],
  ['new migration applied', results.migrationsAfter.length === results.migrationsBefore.length + 1],
  ['new table populated', results.probeRows.length === 1],
  ['pre-existing row survived', results.markerAfter[0]?.value === 'survived'],
  ['backup holds the pre-migration schema', results.backup.probeTable[0]?.present === false],
  ['backup holds the user data', results.backup.marker[0]?.value === 'survived'],
];
results.checks = checks.map(([label, pass]) => ({ label, pass }));
await writeFile(join(here, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(join(here, 'app.log'), await readLog());

console.log('');
for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
const failed = checks.filter(([, pass]) => !pass).length;
console.log(`\n${checks.length - failed}/${checks.length}`);
process.exit(failed ? 1 : 0);
