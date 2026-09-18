// First-run experience: a fresh install with no
// PAT and no LLM key — is the empty state a clear setup path, or a wall of failed
// jobs?
//
// Launches the real compiled shell against an empty userData through
// `entry.cjs`, accepts the consent gate, walks every screen a new user can reach,
// then sits still long enough for the schedulers to run and reads what the job
// queue did.
//
//   pnpm build && pnpm dev:frontend      # vite on :5173, the dev shell loads it
//   node apps/desktop/test/first-run/driver.mjs
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../..');
const require = createRequire(join(repo, 'apps/desktop/package.json'));
const { _electron: electron } = require('playwright');

/** How long to sit on an idle app. The brief dispatcher ticks every ~60 s and the
 *  GitHub sweep runs at launch, so two ticks is enough for both to have had a go. */
const IDLE_MS = Number(process.env.IDLE_MS ?? 150_000);

const SCREENS = [
  ['#/', 'home'],
  ['#/briefs', 'briefs'],
  ['#/schedules', 'schedules'],
  ['#/projects', 'projects'],
  ['#/teams', 'teams'],
  ['#/integrations/github', 'integrations-github'],
  ['#/integrations/ai', 'integrations-ai'],
  ['#/integrations/slack', 'integrations-slack'],
  ['#/settings', 'settings'],
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = join(here, 'shots');
await mkdir(shots, { recursive: true });

const userData = await mkdtemp(join(tmpdir(), 'devsummary-first-run-'));
console.log(`userData: ${userData}`);

const consoleErrors = [];
const results = { userData, screens: [], consoleErrors, jobs: null, log: null };

const app = await electron.launch({
  args: [join(here, 'entry.cjs')],
  cwd: join(repo, 'apps/desktop'),
  env: { ...process.env, FIRST_RUN_USERDATA: userData },
});

const win = await app.firstWindow();
win.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
});
win.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

// The consent gate is the first thing a new user sees, and nothing else renders
// until it is answered.
await win.waitForSelector('#accept-terms', { timeout: 60_000 });
await win.screenshot({ path: join(shots, '00-consent.png') });
results.consentGate = await win
  .locator('[role="dialog"]')
  .first()
  .innerText()
  .then((t) => t.slice(0, 1200));

await win.locator('#accept-terms').click();
await win.getByRole('button', { name: /agree and continue/i }).click();
await win.waitForSelector('#accept-terms', { state: 'detached', timeout: 30_000 });
await delay(4000);

/** What the screen actually says, so "is it a setup path" is answerable from the
 *  receipt without opening every png. */
async function capture(hash, name) {
  await win.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  await delay(2500);
  const text = await win.locator('body').innerText();
  const ctas = await win.getByRole('button').allInnerTexts();
  const links = await win.getByRole('link').allInnerTexts();
  await win.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
  results.screens.push({
    hash,
    name,
    text: text.replace(/\n{2,}/g, '\n').slice(0, 1500),
    actions: [...new Set([...ctas, ...links])].filter(Boolean),
  });
  console.log(`captured ${name}`);
}

for (const [hash, name] of SCREENS) await capture(hash, name);

console.log(`idling ${IDLE_MS / 1000}s to let the schedulers run…`);
await delay(IDLE_MS);

// A second pass over the three screens that would show damage: the dashboard,
// whatever the app says about GitHub, and the AI page — whose first paint is
// four skeletons, because the CLI detect walks a login shell per provider and
// 2.5 s is not enough to see what it settles on.
await capture('#/briefs', 'briefs-after-idle');
await capture('#/integrations/github', 'integrations-github-after-idle');
await capture('#/integrations/ai', 'integrations-ai-after-idle');

await app.close();
await delay(2000);

// What the queue actually did, read from the database the run just wrote.
const { PGlite } = require(join(repo, 'apps/backend/node_modules/@electric-sql/pglite'));
const db = new PGlite(join(userData, 'data'));
const q = async (sql) => (await db.query(sql)).rows;
results.jobs = {
  byStatus: await q(
    "select state, type, count(*)::int as n, max(attempts)::int as max_attempts from public.jobs group by 1, 2 order by 1, 2",
  ),
  failures: await q(
    "select type, state, attempts, left(coalesce(error, ''), 300) as error, run_at from public.jobs where error is not null order by run_at desc limit 20",
  ),
  repositories: await q('select count(*)::int as n from github.repositories'),
  briefs: await q('select count(*)::int as n from briefs.briefs'),
};
await db.close();

// `pino-roll` appends a number, so there is no plain `app.log` — reading one is
// how the first pass reported "0 lines" against a 158-line log.
const logDir = join(userData, 'logs');
const logFile = (await readdir(logDir).catch(() => []))
  .filter((f) => f.startsWith('app.log'))
  .sort()
  .pop();
results.logFile = logFile ?? null;
const logText = logFile
  ? await readFile(join(logDir, logFile), 'utf8').catch(() => '')
  : '';
const lines = logText.split('\n').filter(Boolean).map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
});
results.log = {
  total: lines.length,
  atOrAboveWarn: lines.filter((l) => l && l.level >= 40).length,
  worst: lines
    .filter((l) => l && l.level >= 40)
    .slice(-15)
    .map((l) => `${l.level} ${l.msg ?? ''}`.slice(0, 220)),
};

await writeFile(join(here, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(join(here, 'app.log'), logText);
console.log('\n--- jobs by status ---');
console.table(results.jobs.byStatus);
console.log('--- failures ---');
console.table(results.jobs.failures);
console.log('--- log ---', results.log.total, 'lines,', results.log.atOrAboveWarn, 'at warn+');
console.log('--- console errors ---', consoleErrors.length);
