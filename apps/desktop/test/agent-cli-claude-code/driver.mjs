// Live driver for the Claude Code provider: launches the real Electron shell
// with playwright's _electron API and walks the provider card, Run test,
// the Models card and the logged-out banner,
// screenshotting each. Modelled on apps/desktop/test/e2e-live/driver.mjs.
//
//   pnpm --filter frontend dev          # vite on :5173 (the shell loads it)
//   node apps/desktop/test/agent-cli-claude-code/driver.mjs
//
// Row 8 ("claude logged out") is a SECOND launch carrying
// CLAUDE_CONFIG_DIR=<empty dir>. The shell forwards process.env to the backend
// fork and `runCli` spawns with `env: process.env`, so the CLI behaves exactly
// as logged out without ever touching the user's real ~/.claude login.
//
// Results land in results.json next to the screenshots.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
const { _electron: electron } = require('playwright');

const MAIN = path.join(REPO, 'apps/desktop/dist/main.js');
// Scratch state, so nothing here can touch a real install.
const SCRATCH = process.env.DRIVER_SCRATCH ?? '/tmp/devsummary-agent-cli';
const USER_DATA = path.join(SCRATCH, 'userData');
const EMPTY_CLAUDE_CONFIG = path.join(SCRATCH, 'empty-claude-config');

// The machine facts the card must show. Hard-coded on purpose: "the card shows
// *a* path" proves nothing — the point of the detector is that an Electron GUI
// PATH has no ~/.local/bin, so the card must show the path the login shell
// resolves.
const WANT_VERSION = process.env.DRIVER_WANT_VERSION ?? '2.1.265';
const WANT_PATH =
  process.env.DRIVER_WANT_PATH ?? path.join(os.homedir(), '.local/bin/claude');

const results = [];
let app = null;
let page = null;
let logBuf = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  await page.screenshot({ path: path.join(HERE, `${name}.png`), fullPage: true });
  return `apps/desktop/test/agent-cli-claude-code/${name}.png`;
}

async function step(n, name, fn) {
  const slug = `${String(n).padStart(2, '0')}-${name}`;
  try {
    const note = await fn(slug);
    const png = await shot(slug);
    results.push({ n, name, status: 'PASS', note: note ?? '', png });
    console.log(`\n### STEP ${n} ${name}: PASS ${note ? `— ${note}` : ''}`);
  } catch (err) {
    let png = '';
    try {
      png = await shot(`${slug}-FAIL`);
    } catch {}
    results.push({ n, name, status: 'FAIL', note: String(err?.stack ?? err), png });
    console.log(`\n### STEP ${n} ${name}: FAIL — ${String(err?.stack ?? err)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function launch(tag, extraEnv = {}) {
  logBuf = '';
  const a = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'development', ...extraEnv },
    cwd: REPO,
  });
  const proc = a.process();
  proc.stdout?.on('data', (d) => {
    logBuf += d.toString();
  });
  proc.stderr?.on('data', (d) => {
    logBuf += d.toString();
  });
  const p = await a.firstWindow();
  p.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) {
      const body = String(r.postData() ?? '').slice(0, 160);
      console.log(`  [req] ${r.method()} ${new URL(r.url()).pathname} ${body}`);
    }
  });
  await p.waitForLoadState('domcontentloaded');
  await sleep(2500);
  console.log(`--- launched (${tag}) ---`);
  return [a, p];
}

/**
 * A fresh userData opens the telemetry consent gate over everything, and its
 * dialog overlay swallows every click until it is answered. Accepting it is
 * part of a first run, not part of what this receipt proves.
 */
async function acceptConsent() {
  const box = page.locator('#accept-terms');
  if (!(await box.isVisible().catch(() => false))) return false;
  await box.click();
  await page.locator('button:has-text("Agree and continue")').click();
  await box.waitFor({ state: 'detached', timeout: 20000 });
  await sleep(1200);
  console.log('  accepted the consent gate');
  return true;
}

/** UI navigation via the dev-server URL — the shell has no address bar. */
async function go(route) {
  const want = route.split('?')[0];
  for (let i = 0; i < 3; i++) {
    await page.goto(`http://localhost:5173${route}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(1500);
    if (new URL(page.url()).pathname === want) return;
    console.log(`  go(${route}) landed on ${page.url()} — retrying`);
  }
  throw new Error(`navigation to ${route} stuck at ${page.url()}`);
}

/** The provider cards, in the order the page renders them. */
const cards = () => page.locator('article');
const claudeCard = () => cards().filter({ hasText: 'Claude Code' }).first();

/** Wait for the AI page's provider grid to have settled (no skeletons). */
async function aiPageReady() {
  await go('/integrations/ai');
  await acceptConsent();
  await claudeCard().waitFor({ timeout: 30000 });
  await sleep(500);
}

/**
 * The toast for *this* action, matched on its own text: sonner stacks, so
 * "the first toast" is whichever one has not expired yet. Never remove the
 * nodes — ripping them out from under React blanks the whole page on its next
 * render, which is exactly what happened the first time this driver ran.
 */
async function waitForToast(re, timeout = 150000) {
  const t = page.locator('[data-sonner-toast]').filter({ hasText: re }).first();
  await t.waitFor({ timeout });
  const text = (await t.innerText()).replace(/\n/g, ' ').trim();
  const type = await t.getAttribute('data-type');
  return { text, type };
}

/** Let sonner expire its own toasts, so none is left covering the next button. */
async function toastsGone(timeout = 30000) {
  await page
    .locator('[data-sonner-toast]')
    .last()
    .waitFor({ state: 'detached', timeout })
    .catch(() => {});
  await sleep(400);
}

const main = async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(USER_DATA, { recursive: true });
  // Empty, not missing: `claude` treats an empty CLAUDE_CONFIG_DIR as a fresh
  // machine with no login, which is the state row 8 needs.
  mkdirSync(EMPTY_CLAUDE_CONFIG, { recursive: true });

  [app, page] = await launch('logged in');

  // ------------------------------------------------------------------ 1 ---
  await step(1, 'three-cards-version-and-path', async () => {
    await aiPageReady();
    const texts = await cards().allTextContents();
    assert(texts.length === 3, `expected 3 provider cards, got ${texts.length}: ${JSON.stringify(texts)}`);
    for (const name of ['OpenAI', 'Google Gemini', 'Claude Code']) {
      assert(texts.some((t) => t.includes(name)), `no ${name} card among ${JSON.stringify(texts)}`);
    }
    const cc = await claudeCard().textContent();
    assert(cc.includes(WANT_VERSION), `card missing version ${WANT_VERSION}: ${cc}`);
    assert(cc.includes(WANT_PATH), `card missing absolute path ${WANT_PATH}: ${cc}`);
    assert(cc.includes('local CLI · claude'), `card missing the CLI host line: ${cc}`);
    return `3 cards (OpenAI / Google Gemini / Claude Code); Claude Code card reads "${WANT_VERSION} · ${WANT_PATH}"`;
  });

  // ------------------------------------------------------------------ 2 ---
  await step(2, 'run-test-toast', async () => {
    await claudeCard().locator('button:has-text("Run test")').click();
    const { text, type } = await waitForToast(/Claude Code answered with/);
    assert(type === 'success', `expected a success toast, got ${type}: ${text}`);
    const m = text.match(/Claude Code answered with (\S+) in (\d+) ms/);
    assert(m, `toast did not match the expected shape: "${text}"`);
    return `toast (${type}): "${text}" — model=${m[1]}, ${m[2]} ms`;
  });

  // ------------------------------------------------------------------ 3 ---
  await step(3, 'use-claude-code', async () => {
    await toastsGone();
    // Survives a click, dies on a reload — which is what "no page reload" means.
    await page.evaluate(() => {
      window.__noReloadProbe = 'alive';
    });
    const before = (await cards().allTextContents()).findIndex((t) => t.includes('Claude Code'));
    await claudeCard().locator('button:has-text("Use Claude Code")').click();
    await claudeCard().locator('text=In use').waitFor({ timeout: 30000 });
    await sleep(1200);
    const after = (await cards().allTextContents()).findIndex((t) => t.includes('Claude Code'));
    assert(after === 0, `Claude Code card is at index ${after}, not first (was ${before})`);
    const probe = await page.evaluate(() => window.__noReloadProbe);
    assert(probe === 'alive', 'the page reloaded (probe lost)');
    const cc = await claudeCard().textContent();
    assert(cc.includes('In use'), `badge is not "In use": ${cc}`);
    assert(!cc.includes('Use Claude Code'), `the Use button is still on the active card: ${cc}`);
    const body = await page.locator('body').innerText();
    assert(!/is selected but/.test(body), `the blocked banner is still up: ${body.slice(0, 300)}`);
    const { text, type } = await waitForToast(/Using Claude Code/, 20000);
    return `card moved index ${before} → ${after}, badge "In use", toast (${type}) "${text}", no reload, banner cleared`;
  });

  // ------------------------------------------------------------------ 4 ---
  await step(4, 'models-card', async () => {
    await toastsGone();
    const card = page.locator('[data-slot=card]').filter({ hasText: 'Commit analysis' }).first();
    await card.waitFor({ timeout: 15000 });
    const text = await card.innerText();
    assert(/claude --model/.test(text), `Models card copy does not mention claude --model: ${text}`);
    assert(/claude-code/.test(text), `Models card badge is not claude-code: ${text}`);
    // Positional, not just "contains": haiku has to be the commit-analysis row
    // and sonnet the brief row, in that order.
    assert(
      /Commit analysis[\s\S]*?\bhaiku\b[\s\S]*?Brief writing[\s\S]*?\bsonnet\b/.test(text),
      `models are not haiku (commit analysis) then sonnet (brief): ${text}`,
    );
    const analysis = 'haiku';
    const brief = 'sonnet';
    // Baseline for the (deferred) usage row.
    const usage = await page.locator('[data-slot=card]').filter({ hasText: 'Token usage' }).first().innerText();
    const baseline = usage.replace(/\n+/g, ' ').trim();
    results.push({ n: 4.5, name: 'usage-baseline', status: 'INFO', note: baseline, png: '' });
    console.log(`\n### usage baseline: ${baseline}`);
    return `Commit analysis=${analysis}, Brief writing=${brief}, copy names \`claude --model\`, badge claude-code`;
  });

  writeFileSync(path.join(HERE, 'backend-loggedin.log'), logBuf);
  await app.close();
  await sleep(2500);

  // ------------------------------------------------------------------ 8 ---
  // Second launch, same userData (so claude-code is still the selected
  // provider) but an empty CLAUDE_CONFIG_DIR: the binary is installed and
  // runnable, and every auth-bearing call answers "Not logged in".
  [app, page] = await launch('logged out (empty CLAUDE_CONFIG_DIR)', {
    CLAUDE_CONFIG_DIR: EMPTY_CLAUDE_CONFIG,
  });

  await step(8, 'logged-out', async () => {
    await aiPageReady();
    const cc = await claudeCard().textContent();
    assert(cc.includes('Not logged in'), `badge is not "Not logged in": ${cc}`);
    assert(cc.includes(WANT_PATH), `card lost the path while logged out: ${cc}`);
    const body = await page.locator('body').innerText();
    assert(
      /Claude Code is selected but not logged in/.test(body),
      `no not-logged-in banner: ${body.slice(0, 500)}`,
    );
    assert(/\/login/.test(body), `banner does not name /login: ${body.slice(0, 500)}`);
    assert(/API_FAILED/.test(body), `banner does not name API_FAILED: ${body.slice(0, 500)}`);
    await shot('08a-card-and-banner');

    await claudeCard().locator('button:has-text("Run test")').click();
    const { text, type } = await waitForToast(/Claude Code test failed/);
    assert(type === 'error', `expected an error toast, got ${type}: ${text}`);
    assert(/Not logged in/.test(text), `toast does not name the login failure: ${text}`);
    return `badge "Not logged in", banner names /login + API_FAILED, Run test toast (${type}): "${text}"`;
  });

  writeFileSync(path.join(HERE, 'backend-loggedout.log'), logBuf);
  await app.close();
  writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\n===== SUMMARY =====');
  for (const r of results) console.log(`${r.status}  ${r.n} ${r.name}  ${r.note.slice(0, 200)}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`${results.filter((r) => r.status === 'PASS').length} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (err) => {
  console.error('DRIVER CRASH', err);
  writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
  writeFileSync(path.join(HERE, 'crash.log'), `${String(err?.stack ?? err)}\n\n--- app log ---\n${logBuf}`);
  try {
    await app?.close();
  } catch {}
  process.exit(2);
});
