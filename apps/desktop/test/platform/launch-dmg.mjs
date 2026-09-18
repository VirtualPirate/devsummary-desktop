// §2 "Both mac arches" — install one dmg into a directory that has never held
// it, launch it against a fresh userData, and assert the boot actually happened.
//
// Same shape as apps/desktop/test/packaged-upgrade/driver.mjs (ditto out of the
// mounted dmg, --user-data-dir, wait on the log), minus the upgrade: one build,
// one launch, first-run state. The arch fields are the point — an x86_64-only
// bundle that boots on Apple silicon has been through Rosetta.
//
//   node apps/desktop/test/platform/launch-dmg.mjs <dmg> [label]
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

const [dmg, label = 'launch'] = process.argv.slice(2);
if (!dmg) throw new Error('usage: launch-dmg.mjs <dmg> [label]');

const LAUNCH_TIMEOUT_MS = 300_000;
const RENDERER_TIMEOUT_MS = 60_000;
/** Rosetta is the point of the x64 run: an x86_64-only bundle booting on arm64
 *  has been translated. Passed in so the arm64 control asserts its own arch. */
const EXPECT_ARCH = process.env.EXPECT_ARCH ?? 'x86_64';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (file, args) => execFileSync(file, args, { encoding: 'utf8' });

const scratch = await mkdtemp(join(tmpdir(), `devsummary-${label}-`));
const installDir = join(scratch, 'Applications');
const userData = join(scratch, 'userData');
await mkdir(installDir, { recursive: true });
await mkdir(userData, { recursive: true });
console.log(`scratch: ${scratch}`);

const out = sh('hdiutil', ['attach', dmg, '-nobrowse', '-readonly']);
const mount = out.trim().split('\n').pop().split('\t').pop().trim();
let appPath;
try {
  const app = (await readdir(mount)).find((f) => f.endsWith('.app'));
  if (!app) throw new Error(`no .app inside ${dmg}`);
  sh('ditto', [join(mount, app), join(installDir, app)]);
  appPath = join(installDir, app);
} finally {
  sh('hdiutil', ['detach', mount, '-force']);
}

const bin = join(appPath, 'Contents/MacOS/DevSummary');
const results = {
  dmg,
  label,
  scratch,
  hostArch: process.arch,
  binaryArchs: sh('lipo', ['-archs', bin]).trim(),
  frameworkArchs: sh('lipo', [
    '-archs',
    join(appPath, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'),
  ]).trim(),
  codesign: sh('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]).trim() || 'verified',
};
console.log(`binary: ${results.binaryArchs}, framework: ${results.frameworkArchs}, host: ${results.hostArch}`);

const logDir = join(userData, 'logs');
const readLog = async () => {
  const files = (await readdir(logDir).catch(() => [])).filter((f) => f.startsWith('app.log')).sort();
  const texts = await Promise.all(files.map((f) => readFile(join(logDir, f), 'utf8').catch(() => '')));
  return texts.join('');
};

/** One launch against `userData`. Cold is the number a new user sees; warm is the
 *  same bundle a second time, which on Apple silicon running an x86_64 build is
 *  the one Rosetta has already translated. */
async function launch(name) {
  // The log is appended to across launches — only read what this one writes.
  const before = (await readLog()).length;
  const started = Date.now();
  const child = spawn(bin, [`--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b) => (stderr += b.toString()));
  child.stdout.on('data', () => {});

  let log = '';
  let ready = false;
  while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
    await delay(1000);
    log = (await readLog()).slice(before);
    if (/Nest application successfully started/.test(log)) {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
  }
  const ms = Date.now() - started;
  // The renderer's startup calls come after the backend is up, and under Rosetta
  // they are not instant — wait for them rather than for a fixed guess.
  const deadline = Date.now() + RENDERER_TIMEOUT_MS;
  while (ready && Date.now() < deadline) {
    await delay(1000);
    log = (await readLog()).slice(before);
    if ((log.match(/"statusCode":/g) ?? []).length >= 8) break;
  }
  child.kill('SIGTERM');
  await delay(6000);
  child.kill('SIGKILL');
  await delay(2000);

  const step = {
    name,
    ms,
    ready,
    exitCode: child.exitCode,
    stderr: stderr.slice(-800),
    statuses: [...log.matchAll(/"statusCode":(\d{3})/g)].map((m) => m[1]),
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
    log,
  };
  console.log(`${name}: ready=${ready} in ${ms} ms, ${step.statuses.length} api calls, exit ${step.exitCode}`);
  return step;
}

const cold = await launch('cold');
const warm = await launch('warm');
results.cold = cold;
results.warm = warm;
results.ms = cold.ms;
results.ready = cold.ready;
results.stderr = cold.stderr + warm.stderr;

results.clusterCreated = existsSync(join(userData, 'data', 'PG_VERSION'));
results.secretsWritten = existsSync(join(userData, 'secrets.bin'));
if (results.clusterCreated) {
  const db = new PGlite(join(userData, 'data'));
  try {
    results.migrations = (await db.query('select count(*)::int as n from kysely_migration')).rows[0].n;
  } finally {
    await db.close();
  }
}

const checks = [
  ['bundle matches the arch it was built for', results.binaryArchs === EXPECT_ARCH && results.frameworkArchs === EXPECT_ARCH],
  ['cold launch booted the backend', cold.ready],
  ['warm launch booted the backend', warm.ready],
  ['PGlite cluster created', results.clusterCreated],
  ['all migrations applied', results.migrations === 16],
  ['second launch migrates nothing', warm.migrationLines.some((l) => /up to date/.test(l))],
  ['secrets.bin written via safeStorage', results.secretsWritten],
  ['renderer served 200s', cold.statuses.length >= 8 && [...cold.statuses, ...warm.statuses].every((s) => s === '200')],
  ['clean stderr', results.stderr.trim() === ''],
];
results.checks = checks;
await writeFile(join(here, `${label}.json`), JSON.stringify(results, null, 2));
await writeFile(join(here, `${label}.log`), `---- cold ----\n${cold.log}\n---- warm ----\n${warm.log}`);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`${checks.filter(([, ok]) => ok).length} of ${checks.length}, boot ${results.ms} ms`);
await rm(scratch, { recursive: true, force: true });
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
