// Assertions for the Linux run, host-side: run-appimage.sh leaves the app's
// userData on a bind mount, and this reads it exactly the way launch-dmg.mjs
// reads the mac one. Kept separate because the launch mechanics differ (a
// container, not hdiutil) while the evidence is the same.
//
//   node apps/desktop/test/platform/check-linux.mjs <userData> [label]
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../../../apps/backend/package.json'));
const { PGlite } = require('@electric-sql/pglite');

const [userData, label = 'linux'] = process.argv.slice(2);
if (!userData) throw new Error('usage: check-linux.mjs <userData> [label]');

const logDir = join(userData, 'logs');
const files = (await readdir(logDir).catch(() => [])).filter((f) => f.startsWith('app.log')).sort();
const log = (
  await Promise.all(files.map((f) => readFile(join(logDir, f), 'utf8').catch(() => '')))
).join('');

const results = { userData, label, logFiles: files };
results.booted = /Nest application successfully started/.test(log);
results.clusterCreated = existsSync(join(userData, 'data', 'PG_VERSION'));
results.secretsWritten = existsSync(join(userData, 'secrets.bin'));
results.statuses = [...log.matchAll(/"statusCode":(\d{3})/g)].map((m) => m[1]);
results.migrationLines = log
  .split('\n')
  .filter((l) => /migration|backed up|up to date/.test(l))
  .map((l) => {
    try {
      return JSON.parse(l).msg;
    } catch {
      return l.slice(0, 160);
    }
  });
if (results.clusterCreated) {
  const db = new PGlite(join(userData, 'data'));
  try {
    results.migrations = (await db.query('select count(*)::int as n from kysely_migration')).rows[0].n;
    results.tables = (
      await db.query("select count(*)::int as n from information_schema.tables where table_schema='public'")
    ).rows[0].n;
  } finally {
    await db.close();
  }
}

const checks = [
  ['backend booted', results.booted],
  ['PGlite cluster created', results.clusterCreated],
  ['all migrations applied', results.migrations === 16],
  ['renderer served 200s', results.statuses.length >= 8 && results.statuses.every((s) => s === '200')],
  // No keyring in the container, so safeStorage is unavailable: the app must
  // refuse to write the file rather than put a plaintext PAT in it (§3).
  ['no plaintext secrets without a keyring', !results.secretsWritten],
];
results.checks = checks;
await writeFile(join(here, `${label}.json`), JSON.stringify(results, null, 2));
await writeFile(join(here, `${label}.log`), log);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`${checks.filter(([, ok]) => ok).length} of ${checks.length}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
