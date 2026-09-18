// Real-credential end-to-end driver: the actual Electron app, a real GitHub
// fine-grained PAT, the real Claude Code CLI as the LLM, a real repository
// ingested from api.github.com, a real brief generated and delivered.
//
//   pnpm build:packages && pnpm build:backend && pnpm --filter desktop build
//   pnpm --filter frontend dev                 # vite on :5173 (the shell loads it)
//   node apps/desktop/test/e2e-real/driver.mjs [path-to-pat-file]
//
// The PAT is read from a file (argv[2], or $DEVSUMMARY_PAT_FILE) and never
// printed, never written to results.json, and masked out of the request log.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
const { _electron: electron } = require('playwright');

const MAIN = path.join(REPO, 'apps/desktop/dist/main.js');
const USER_DATA = '/tmp/devsummary-e2e-real';
const PAT_FILE = process.argv[2] ?? process.env.DEVSUMMARY_PAT_FILE;
const WANT_REPO = process.env.DEVSUMMARY_REPO ?? 'VirtualPirate/electron-template';
const LOOKBACK = 30;
const BRANCH = process.env.DEVSUMMARY_BRANCH ?? 'main';
// Re-runs of the later steps must not re-spend the CLI on 52 commits that are
// already analysed, so the data directory survives when this is set.
const RESUME = process.env.DEVSUMMARY_RESUME === '1';
// Ingest of ~30 commits through a CLI that spawns per batch is minutes, not
// seconds; the cap is what turns "still working" into a failed step.
const INGEST_TIMEOUT_MS = 45 * 60_000;
const BRIEF_TIMEOUT_MS = 15 * 60_000;

if (!PAT_FILE) throw new Error('usage: driver.mjs <path-to-pat-file>');
const PAT = readFileSync(PAT_FILE, 'utf8').trim();
if (!PAT) throw new Error(`${PAT_FILE} is empty`);

const results = [];
const mutations = [];
let app = null;
let page = null;
let logBuf = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => (PAT && s ? s.split(PAT).join('***PAT***') : s);

async function shot(name) {
  await page.screenshot({ path: path.join(HERE, `${name}.png`) });
  return `apps/desktop/test/e2e-real/${name}.png`;
}

async function step(n, name, fn) {
  const slug = `${String(n).padStart(2, '0')}-${name}`;
  const t0 = Date.now();
  try {
    const note = await fn(slug);
    const png = await shot(slug);
    results.push({ n, name, status: 'PASS', ms: Date.now() - t0, note: note ?? '', png });
    console.log(`\n### STEP ${n} ${name}: PASS — ${note ?? ''}`);
  } catch (err) {
    let png = '';
    try { png = await shot(`${slug}-FAIL`); } catch {}
    const msg = mask(String(err?.stack ?? err));
    results.push({ n, name, status: 'FAIL', ms: Date.now() - t0, note: msg, png });
    console.log(`\n### STEP ${n} ${name}: FAIL — ${msg}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function launch(tag) {
  const a = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'development' },
    cwd: REPO,
  });
  const proc = a.process();
  const sink = (d) => { logBuf += mask(d.toString()); };
  proc.stdout?.on('data', sink);
  proc.stderr?.on('data', sink);
  const p = await a.firstWindow();
  // Every mutating API call, so a connect nobody scripted is attributable.
  p.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) {
      const entry = {
        at: new Date().toISOString(),
        method: r.method(),
        path: new URL(r.url()).pathname,
        body: mask(String(r.postData() ?? '')).slice(0, 200),
      };
      mutations.push(entry);
      console.log(`  [req ${entry.at}] ${entry.method} ${entry.path} ${entry.body}`);
    }
  });
  await p.waitForLoadState('domcontentloaded');
  await sleep(2500);
  console.log(`--- launched (${tag}) ---`);
  return [a, p];
}

/** A fresh userData opens the consent gate over everything; answering it is a first run. */
async function acceptConsent() {
  const box = page.locator('#accept-terms');
  if (!(await box.isVisible().catch(() => false))) return false;
  await box.click();
  await page.locator('button:has-text("Agree and continue")').click();
  await box.waitFor({ state: 'detached', timeout: 20000 });
  await sleep(1000);
  console.log('  accepted the consent gate');
  return true;
}

/**
 * The shell has no address bar, and the router is on **hash** history — a
 * `file://` document has an opaque origin, so pushState is rejected and the
 * packaged build had to move. The dev
 * shell runs the same router, so every route here is `/#<route>`.
 */
async function go(route) {
  const want = route.split('?')[0];
  const at = () => new URL(page.url()).hash.replace(/^#/, '').split('?')[0] || '/';
  for (let i = 0; i < 3; i++) {
    await page.goto(`http://localhost:5173/#${route}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(1500);
    await acceptConsent();
    if (at() === want) return;
    console.log(`  go(${route}) landed on ${page.url()} — retrying`);
  }
  throw new Error(`navigation to ${route} stuck at ${page.url()}`);
}

/** Read any org-scoped endpoint from the renderer (port + per-boot token + org header). */
function api(pathname, init) {
  return page.evaluate(
    async ([p, i]) => {
      const { port, token } = await window.desktop.apiConfig();
      const org = JSON.parse(
        localStorage.getItem('launchstack.activeOrganization') ?? '{}',
      )?.state?.activeOrganizationId;
      const res = await fetch(`http://127.0.0.1:${port}${p}`, {
        method: i?.method ?? 'GET',
        headers: {
          'x-desktop-token': token,
          'X-Organization-Id': org,
          ...(i?.body ? { 'content-type': 'application/json' } : {}),
        },
        body: i?.body,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [pathname, init ?? null],
  );
}

async function waitForToast(re, timeout = 180000) {
  const t = page.locator('[data-sonner-toast]').filter({ hasText: re }).first();
  await t.waitFor({ timeout });
  return {
    text: (await t.innerText()).replace(/\n/g, ' ').trim(),
    type: await t.getAttribute('data-type'),
  };
}

async function toastsGone(timeout = 30000) {
  await page.locator('[data-sonner-toast]').last()
    .waitFor({ state: 'detached', timeout }).catch(() => {});
  await sleep(400);
}

const cards = () => page.locator('article');
const claudeCard = () => cards().filter({ hasText: 'Claude Code' }).first();

const main = async () => {
  if (!RESUME) rmSync(USER_DATA, { recursive: true, force: true });
  mkdirSync(USER_DATA, { recursive: true });

  [app, page] = await launch('boot 1');
  let repoRowId = null;

  // ------------------------------------------------------------------ 1 ---
  await step(1, 'claude-code-selected', async () => {
    await go('/integrations/ai');
    await claudeCard().waitFor({ timeout: 30000 });
    const cardText = await claudeCard().textContent();
    await claudeCard().locator('button:has-text("Run test")').click();
    const test = await waitForToast(/Claude Code answered with/);
    assert(test.type === 'success', `test toast was ${test.type}: ${test.text}`);
    await toastsGone();
    const inUse = (await claudeCard().textContent()).includes('In use');
    if (!inUse) await claudeCard().locator('button:has-text("Use Claude Code")').click();
    await claudeCard().locator('text=In use').waitFor({ timeout: 30000 });
    const settings = await api('/api/local-settings');
    const provider = settings.json?.data?.llmProvider;
    assert(provider === 'claude-code', `llmProvider is ${JSON.stringify(provider)}, not claude-code`);
    const models = `${settings.json?.data?.commitAnalysisModel} / ${settings.json?.data?.briefModel}`;
    return `card "${cardText.replace(/\s+/g, ' ').slice(0, 90)}"; ${test.text}; provider=${provider}, models ${models}`;
  });

  // ------------------------------------------------------------------ 2 ---
  await step(2, 'connect-real-pat', async (slug) => {
    await toastsGone();
    const already = (await api('/api/integrations/github')).json?.data ?? [];
    if (RESUME && already.length === 1) {
      repoRowId = (already[0].repositories ?? []).find((r) => r.fullName === WANT_REPO)?.id ?? null;
      return `resumed: ${already[0].accountLogin} already connected, ${already[0].repositories.length} repo(s)`;
    }
    await go('/integrations/github');
    await page.locator('#github-pat').waitFor({ timeout: 15000 });
    await shot(`${slug}a-form`);
    await page.fill('#github-pat', PAT);
    await page.click('button:has-text("Connect GitHub")');
    // A wide token lists every repository it can see before the handler
    // returns, so the round trip is tens of seconds, not the one second the
    // button's spinner suggests. Poll the store rather than time a sleep.
    let list = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const installs = await api('/api/integrations/github');
      list = installs.json?.data ?? [];
      if (list.length > 0) break;
      const err = page.locator('[data-sonner-toast][data-type=error]').first();
      if (await err.isVisible().catch(() => false)) {
        throw new Error(`connect rejected: ${(await err.innerText()).replace(/\n/g, ' ')}`);
      }
      await sleep(3000);
    }
    assert(list.length === 1, `expected 1 installation after ${Math.round((Date.now() - t0) / 1000)}s, got ${list.length}`);
    const repos = list[0].repositories ?? [];
    const names = repos.map((r) => r.fullName);
    assert(names.includes(WANT_REPO), `${WANT_REPO} not among ${names.length} granted repos`);
    repoRowId = repos.find((r) => r.fullName === WANT_REPO).id;
    return `account ${list[0].accountLogin}, ${repos.length} repo(s) granted: ${JSON.stringify(names)}`;
  });

  // ------------------------------------------------------------------ 3 ---
  await step(3, 'branch-setup-start-ingest', async (slug) => {
    const state = (await api('/api/integrations/github/repositories/ingest-status')).json?.data;
    if (RESUME && (state?.repositories ?? []).length === 1) {
      return `resumed: already tracking ${state.repositories[0].fullName} on ${state.repositories[0].branch}`;
    }
    await go('/integrations/github/setup');
    const box = page.locator(`[aria-label="Analyze ${WANT_REPO}"]`);
    await box.waitFor({ timeout: 60000 });
    // Every granted repository is pre-selected on its default branch, and this
    // token grants dozens — skipping all first is what keeps the run to one.
    await page.locator('button:has-text("Skip all")').first().click();
    await sleep(500);
    const row = page.locator('div').filter({ has: box }).last();
    const picker = row.locator('button[role=combobox]').first();
    await picker.waitFor({ timeout: 120000 });
    for (let i = 0; i < 30 && (await picker.innerText()).includes('Loading'); i++) await sleep(2000);
    await picker.click();
    await page.locator('[cmdk-item], [role=option]').filter({ hasText: BRANCH }).first().click();
    await sleep(800);
    await shot(`${slug}a-branch-list`);
    // 90 days is the default; 30 is the brake on how much real CLI time this
    // run spends. The picker is a popover behind a "Change" link.
    await page.locator('button:has-text("Change")').first().click();
    await page.locator('button', { hasText: 'Last 30 days' }).first().click();
    await sleep(800);
    const footer = await page.locator('text=/History:/').first().innerText();
    assert(/last 30 days/i.test(footer), `history window did not switch: ${footer}`);
    const start = page.locator('button', { hasText: /^Start analyzing/ }).first();
    await start.waitFor({ timeout: 30000 });
    const startLabel = (await start.innerText()).replace(/\s+/g, ' ').trim();
    assert(/^Start analyzing 1 repository$/.test(startLabel), `button would start more than one repo: "${startLabel}"`);
    await start.click();
    await page.locator('text=/Started/i').first().waitFor({ timeout: 60000 });
    await shot(`${slug}b-started`);
    const status = await api('/api/integrations/github/repositories/ingest-status');
    const tracked = status.json?.data?.repositories ?? [];
    assert(tracked.length === 1, `expected 1 tracked repository, got ${tracked.length}`);
    return `"${startLabel.replace(/\s+/g, ' ')}" → tracking ${tracked[0].fullName} on ${tracked[0].branch}`;
  });

  // ------------------------------------------------------------------ 4 ---
  await step(4, 'ingest-and-analyze', async (slug) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < INGEST_TIMEOUT_MS) {
      const res = await api('/api/integrations/github/repositories/ingest-status');
      const data = res.json?.data;
      const repo = data?.repositories?.[0];
      if (repo) {
        const line = `fetch=${repo.fetching?.state} analyze=${repo.analyzing?.state} commits=${repo.commitCount} processed=${repo.processedCount} skipped=${repo.skippedCount} failed=${repo.failedCount}`;
        if (line !== last) { console.log(`  [ingest +${Math.round((Date.now() - t0) / 1000)}s] ${line}`); last = line; }
        if (data.ingesting === false && repo.commitCount > 0 && repo.processedCount >= repo.commitCount) {
          await go('/');
          await shot(`${slug}a-dashboard`);
          assert(repo.failedCount === 0, `${repo.failedCount} analyses failed terminally`);
          return `${repo.commitCount} commits fetched, ${repo.processedCount} processed (${repo.skippedCount} skipped, ${repo.failedCount} failed) in ${Math.round((Date.now() - t0) / 1000)}s`;
        }
      }
      await sleep(10000);
    }
    throw new Error(`ingest did not finish in ${INGEST_TIMEOUT_MS / 60000} min — last: ${last}`);
  });

  // ------------------------------------------------------------------ 5 ---
  await step(5, 'generate-brief', async (slug) => {
    await go('/briefs');
    await sleep(2000);
    await shot(`${slug}a-briefs-page`);
    // Empty state: "Generate one brief instead". Populated page: "Generate now".
    const opener = page.locator('button', { hasText: /Generate one brief instead|Generate now/ }).first();
    await opener.waitFor({ timeout: 30000 });
    await opener.click();
    await page.locator('text=Generate brief now').waitFor({ timeout: 20000 });
    await page.locator('button', { hasText: /^Repository$/ }).first().click();
    await sleep(1500);
    await page.locator('button', { hasText: /^30 days$/ }).first().click();
    await sleep(3000);
    await shot(`${slug}b-dialog`);
    const submit = page.locator('button[type=submit]').first();
    const label = await submit.innerText();
    await submit.click();
    await page.waitForURL(/#\/briefs\/[0-9a-f-]{36}/, { timeout: 60000 });
    const briefId = page.url().match(/briefs\/([0-9a-f-]{36})/)[1];
    const t0 = Date.now();
    let brief = null;
    while (Date.now() - t0 < BRIEF_TIMEOUT_MS) {
      const res = await api(`/api/organizations/current/briefs/${briefId}`);
      brief = res.json?.data;
      if (brief && brief.status !== 'pending' && brief.status !== 'generating') break;
      await sleep(8000);
    }
    assert(brief, 'brief never came back from the API');
    assert(
      brief.status === 'generated' || brief.status === 'delivered',
      `brief ended ${brief.status}: ${brief.failureReason ?? ''}`,
    );
    return `dialog button "${label}"; brief ${briefId} → ${brief.status} in ${Math.round((Date.now() - t0) / 1000)}s: "${brief.title}"`;
  });

  // ------------------------------------------------------------------ 6 ---
  await step(6, 'brief-content-and-delivery', async (slug) => {
    await page.reload();
    await sleep(4000);
    await shot(`${slug}a-detail`);
    const res = await api('/api/organizations/current/briefs');
    const brief = (res.json?.data?.items ?? [])[0] ?? null;
    assert(brief, `no brief in the list response: ${JSON.stringify(res.json).slice(0, 200)}`);
    assert(brief.title?.length > 0, 'brief has no title');
    assert(brief.summary?.length > 0, 'brief has no summary');
    assert(brief.commitCount > 0, `brief covers ${brief.commitCount} commits`);
    const channels = brief.deliveredChannels ?? [];
    const notified = /notification posted|desktop notification/i.test(logBuf);
    return `title "${brief.title}" · ${brief.commitCount} commits · ${brief.contributorCount} contributor(s) · status ${brief.status} · channels ${JSON.stringify(channels)} · shell notification logged: ${notified}`;
  });

  // ------------------------------------------------------------------ 7 ---
  await step(7, 'no-stray-connect', async () => {
    const connects = mutations.filter((m) => m.path === '/api/integrations/github/token');
    const installs = await api('/api/integrations/github');
    const list = installs.json?.data ?? [];
    const logConnects = (logBuf.match(/POST \/api\/integrations\/github\/token/g) ?? []).length;
    // On a resumed run the connect belongs to the earlier launch; the backend
    // log is then the only witness, and one real POST is still the invariant.
    assert(
      connects.length === (RESUME ? 0 : 1),
      `${connects.length} connect requests from the renderer: ${JSON.stringify(connects)}`,
    );
    assert(list.length === 1, `${list.length} installations exist, expected 1`);
    const repos = list[0].repositories ?? [];
    const tracked = repos.filter((r) => r.branch !== null).map((r) => r.fullName);
    // Breadth is the token's, not a bug: what matters is that nothing beyond
    // the one chosen repository ever started reading commits.
    assert(tracked.length === 1 && tracked[0] === WANT_REPO, `tracked repositories: ${JSON.stringify(tracked)}`);
    return `1 renderer connect, ${logConnects} in the backend log, 1 installation holding ${repos.length} repo(s), exactly 1 tracked: ${tracked[0]}`;
  });

  await app.close().catch(() => {});
  await sleep(2000);

  // ------------------------------------------------------------- 8 (DB) ---
  // The token columns, read after the app is closed: PGlite takes one writer
  // at a time.
  const dbFacts = await readDb();
  results.push({ n: 8, name: 'token-columns', status: dbFacts.ok ? 'PASS' : 'FAIL', note: dbFacts.note, png: '' });
  console.log(`\n### STEP 8 token-columns: ${dbFacts.ok ? 'PASS' : 'FAIL'} — ${dbFacts.note}`);

  writeFileSync(
    path.join(HERE, 'results.json'),
    JSON.stringify({ repo: WANT_REPO, lookbackDays: LOOKBACK, results, mutations, db: dbFacts.rows }, null, 2),
  );
  writeFileSync(path.join(HERE, 'backend.log'), logBuf);
  const failed = results.filter((r) => r.status !== 'PASS').length;
  console.log(`\n=== ${results.length - failed}/${results.length} PASS ===`);
  process.exit(failed ? 1 : 0);
};

async function readDb() {
  const backendRequire = createRequire(path.join(REPO, 'apps/backend/package.json'));
  const { PGlite } = await import(pathToFileURL(backendRequire.resolve('@electric-sql/pglite')).href);
  const db = new PGlite(path.join(USER_DATA, 'data'));
  const q = async (sql) => (await db.query(sql)).rows;
  try {
    const analyses = await q(`
      select status, model, count(*)::int as n,
             sum(prompt_tokens)::int as prompt_tokens,
             sum(completion_tokens)::int as completion_tokens
      from github.commit_analyses group by status, model order by n desc`);
    const briefs = await q(`
      select status, model, prompt_tokens, completion_tokens, commit_count,
             contributor_count, delivered_channels, title
      from briefs.briefs`);
    const commits = await q(`select count(*)::int as n from github.commits`);
    const analysed = analyses.filter((r) => r.status === 'analyzed');
    const aPrompt = analysed.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0);
    const aCompletion = analysed.reduce((s, r) => s + (r.completion_tokens ?? 0), 0);
    const b = briefs[0];
    const ok =
      aPrompt > 0 && aCompletion > 0 && !!b &&
      (b.prompt_tokens ?? 0) > 0 && (b.completion_tokens ?? 0) > 0;
    await db.close();
    return {
      ok,
      note: `commits=${commits[0].n}; analyses ${JSON.stringify(analyses)}; brief tokens ${b?.prompt_tokens}/${b?.completion_tokens} model=${b?.model} channels=${JSON.stringify(b?.delivered_channels)}`,
      rows: { commits: commits[0].n, analyses, briefs },
    };
  } catch (err) {
    await db.close().catch(() => {});
    return { ok: false, note: mask(String(err?.stack ?? err)), rows: null };
  }
}

main().catch(async (err) => {
  console.error(mask(String(err?.stack ?? err)));
  try { writeFileSync(path.join(HERE, 'results.json'), JSON.stringify({ results, mutations, fatal: mask(String(err)) }, null, 2)); } catch {}
  try { await app?.close(); } catch {}
  process.exit(1);
});
