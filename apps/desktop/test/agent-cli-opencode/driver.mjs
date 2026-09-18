// Live driver for the OpenCode provider card: launches the real Electron shell
// with playwright's _electron API and walks the provider card and Models card,
// plus Run test through the real backend and the real `opencode` binary
// (no `opencode auth` ever runs). Modelled on
// ../agent-cli-claude-code/driver.mjs.
//
//   pnpm --filter frontend dev          # vite on :5173 (the shell loads it)
//   node apps/desktop/test/agent-cli-opencode/driver.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
const { _electron: electron } = require('playwright');

const MAIN = path.join(REPO, 'apps/desktop/dist/main.js');
const SCRATCH = process.env.DRIVER_SCRATCH ?? '/tmp/devsummary-agent-cli-opencode';
const USER_DATA = path.join(SCRATCH, 'userData');

const WANT_VERSION = process.env.DRIVER_WANT_VERSION ?? '1.1.53';
const WANT_PATH = process.env.DRIVER_WANT_PATH ?? '/opt/homebrew/bin/opencode';
// The model Run test resolves: the backend seeds OPENCODE_COMMIT_ANALYSIS_MODEL
// from its env, and the shell forwards process.env, so exporting it before this
// driver runs is the same as changing it on the Models card. The default
// `opencode/big-pickle` is anonymous Zen and throttles after a couple of calls
// once its quota is spent, so a real run points it at a model
// the user has connected inside opencode.
const WANT_MODEL = process.env.OPENCODE_COMMIT_ANALYSIS_MODEL ?? 'opencode/big-pickle';

const results = [];
let app = null;
let page = null;
let logBuf = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  await page.screenshot({ path: path.join(HERE, `${name}.png`), fullPage: true });
  return `apps/desktop/test/agent-cli-opencode/${name}.png`;
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

const cards = () => page.locator('article');
const openCodeCard = () => cards().filter({ hasText: 'OpenCode' }).first();

async function aiPageReady() {
  await go('/integrations/ai');
  await acceptConsent();
  await openCodeCard().waitFor({ timeout: 30000 });
  await sleep(500);
}

async function waitForToast(re, timeout = 150000) {
  const t = page.locator('[data-sonner-toast]').filter({ hasText: re }).first();
  await t.waitFor({ timeout });
  const text = (await t.innerText()).replace(/\n/g, ' ').trim();
  const type = await t.getAttribute('data-type');
  return { text, type };
}

const main = async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(USER_DATA, { recursive: true });

  [app, page] = await launch('fresh userData');

  // ------------------------------------------------------------------ 1 ---
  await step(1, 'four-cards-version-and-path', async () => {
    await aiPageReady();
    const texts = await cards().allTextContents();
    assert(texts.length === 4, `expected 4 provider cards, got ${texts.length}: ${JSON.stringify(texts)}`);
    for (const name of ['OpenAI', 'Google Gemini', 'Claude Code', 'OpenCode']) {
      assert(texts.some((t) => t.includes(name)), `no ${name} card among ${JSON.stringify(texts)}`);
    }
    const oc = await openCodeCard().textContent();
    assert(oc.includes(WANT_VERSION), `card missing version ${WANT_VERSION}: ${oc}`);
    assert(oc.includes(WANT_PATH), `card missing absolute path ${WANT_PATH}: ${oc}`);
    assert(oc.includes('local CLI · opencode'), `card missing the CLI host line: ${oc}`);
    assert(!oc.includes('Not logged in'), `card claims a login state it cannot know: ${oc}`);
    return `4 cards; OpenCode card reads "${WANT_VERSION} · ${WANT_PATH}", no login badge`;
  });

  // ------------------------------------------------------------------ 2 ---
  await step(2, 'run-test', async () => {
    await openCodeCard().locator('button:has-text("Run test")').click();
    const { text, type } = await waitForToast(/OpenCode answered with/);
    assert(type === 'success', `expected a success toast, got ${type}: ${text}`);
    const m = text.match(/OpenCode answered with (\S+) in (\d+) ms/);
    assert(m, `toast did not match the expected shape: "${text}"`);
    assert(m[1] === WANT_MODEL, `answered with ${m[1]}, not ${WANT_MODEL}`);
    return `toast (${type}): "${text}"`;
  });

  writeFileSync(path.join(HERE, 'backend.log'), logBuf);
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
