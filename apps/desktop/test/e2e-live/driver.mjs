// Live end-to-end driver: launches the real Electron app with playwright's
// _electron API and walks the 12 verification steps, screenshotting each.
//
//   pnpm --filter frontend dev          # vite on :5173 (the shell loads it)
//   node apps/desktop/test/e2e-live/driver.mjs
//
// Results land in results.json next to the screenshots.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
const { _electron: electron } = require('playwright');

const MAIN = path.join(REPO, 'apps/desktop/dist/main.js');
const USER_DATA = '/tmp/devsummary-e2e-live';
const SMTP_PORT = 2525;

const results = [];
let stepNo = 0;
let app = null;
let page = null;
let logBuf = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  await page.screenshot({ path: path.join(HERE, `${name}.png`) });
  return `apps/desktop/test/e2e-live/${name}.png`;
}

async function step(n, name, fn) {
  stepNo = n;
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

async function launch(tag) {
  logBuf = '';
  const a = await electron.launch({
    args: [MAIN, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'development' },
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
  // Every mutating API call, so an unexpected one (a stray retry, a resubmit)
  // is attributable instead of a mystery in the backend log.
  p.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/')) {
      const body = String(r.postData() ?? '').slice(0, 160);
      console.log(`  [req ${new Date().toISOString()}] ${r.method()} ${new URL(r.url()).pathname} ${body}`);
    }
  });
  await p.waitForLoadState('domcontentloaded');
  await sleep(2500);
  console.log(`--- launched (${tag}) ---`);
  return [a, p];
}

async function apiConfig() {
  return page.evaluate(() => window.desktop.apiConfig());
}

/** UI navigation via the dev-server URL — the shell has no address bar. */
async function go(route) {
  const want = route.split('?')[0];
  for (let i = 0; i < 3; i++) {
    await page.goto(`http://localhost:5173${route}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(1200);
    if (new URL(page.url()).pathname === want) return;
    console.log(`  go(${route}) landed on ${page.url()} — retrying`);
  }
  throw new Error(`navigation to ${route} stuck at ${page.url()}`);
}

/**
 * Radix drops the dropdown on the click that follows a selection often enough
 * to make a single attempt flaky, so retry the open until the item is there.
 */
async function switchOrg(to) {
  const trigger = page.locator('header button[aria-haspopup="menu"]').first();
  const item = page.locator('[role=menuitem]', { hasText: to }).first();
  for (let i = 0; i < 6; i++) {
    await trigger.click({ force: true });
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      await page.locator('header button', { hasText: to }).first().waitFor({ timeout: 15000 });
      await sleep(1200);
      return;
    }
    await page.keyboard.press('Escape');
    await sleep(600);
  }
  throw new Error(`could not switch workspace to ${to}`);
}

/** Read an org-scoped endpoint straight from the renderer (port + token + org header). */
function api(pathname) {
  return page.evaluate(async (p) => {
    const { port, token } = await window.desktop.apiConfig();
    const org = JSON.parse(
      localStorage.getItem('launchstack.activeOrganization') ?? '{}',
    )?.state?.activeOrganizationId;
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      headers: { 'x-desktop-token': token, 'X-Organization-Id': org },
    });
    return (await res.json()).data;
  }, pathname);
}

/**
 * Just enough SMTP for `transporter.verify()` (connect + EHLO + AUTH). The
 * settings screen refuses to store credentials it has not proved, so without a
 * server on the other end "SMTP fields save" is unverifiable.
 */
function fakeSmtp(port) {
  const net = require('node:net');
  const server = net.createServer((sock) => {
    sock.write('220 localhost ESMTP fake\r\n');
    let expectAuthArg = false;
    sock.on('data', (buf) => {
      for (const line of buf.toString().split('\r\n').filter(Boolean)) {
        if (expectAuthArg) {
          expectAuthArg = false;
          sock.write('235 2.7.0 Accepted\r\n');
        } else if (/^EHLO/i.test(line)) {
          // PLAIN only, so nodemailer's method auto-pick is deterministic.
          sock.write('250-localhost\r\n250-AUTH PLAIN\r\n250 OK\r\n');
        } else if (/^HELO/i.test(line)) {
          sock.write('250 localhost\r\n');
        } else if (/^AUTH PLAIN/i.test(line)) {
          if (line.trim().split(/\s+/).length > 2) sock.write('235 2.7.0 Accepted\r\n');
          else {
            sock.write('334 \r\n');
            expectAuthArg = true;
          }
        } else if (/^QUIT/i.test(line)) {
          sock.write('221 Bye\r\n');
          sock.end();
        } else {
          sock.write('250 OK\r\n');
        }
      }
    });
    sock.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return server;
}

const main = async () => {
  rmSync(USER_DATA, { recursive: true, force: true });
  mkdirSync(USER_DATA, { recursive: true });
  const smtp = fakeSmtp(SMTP_PORT);

  [app, page] = await launch('boot 1');
  const boot1Log = () => logBuf;

  // ------------------------------------------------------------------ 1 ---
  await step(1, 'dashboard-autologin', async () => {
    const body = await page.locator('body').innerText();
    assert(!/sign in|sign up|log in|create an account/i.test(body), `auth text on screen: ${body.slice(0, 400)}`);
    const switcher = page.locator('header button', { hasText: 'My Workspace' });
    await switcher.first().waitFor({ timeout: 15000 });
    assert(await page.locator('nav a', { hasText: 'Settings' }).count(), 'no sidebar');
    return 'switcher shows My Workspace, no auth screen';
  });

  // ------------------------------------------------------------------ 2 ---
  await step(2, 'backend-loopback-401', async () => {
    const cfg = await apiConfig();
    assert(typeof cfg.port === 'number' && cfg.port > 0, `bad port ${JSON.stringify(cfg)}`);
    const listen = execFileSync('lsof', ['-nP', `-iTCP:${cfg.port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    const lines = listen.trim().split('\n').slice(1);
    assert(lines.length > 0, 'nothing listening');
    for (const l of lines) {
      assert(/127\.0\.0\.1:/.test(l), `not loopback-only: ${l}`);
      assert(!/\*:|0\.0\.0\.0:|\[::\]/.test(l), `wildcard bind: ${l}`);
    }
    const code = execFileSync(
      'curl',
      ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${cfg.port}/api/local-settings`],
      { encoding: 'utf8' },
    );
    assert(code === '401', `expected 401 without token, got ${code}`);
    const okCode = execFileSync(
      'curl',
      [
        '-s', '-o', '/dev/null', '-w', '%{http_code}',
        '-H', `x-desktop-token: ${cfg.token}`,
        `http://127.0.0.1:${cfg.port}/api/local-settings`,
      ],
      { encoding: 'utf8' },
    );
    assert(okCode === '200', `expected 200 with token, got ${okCode}`);
    // Prove it is not reachable off-loopback either.
    return `port ${cfg.port} LISTEN 127.0.0.1 only; no-token=401, token=200`;
  });

  // ------------------------------------------------------------------ 3 ---
  await step(3, 'workspaces', async (slug) => {
    // create
    await go('/organizations/new');
    await page.fill('#org-name', 'Second Workspace');
    await page.click('button[type=submit]');
    await page.locator('header button', { hasText: 'Second Workspace' }).first().waitFor({ timeout: 15000 });
    await shot(`${slug}a-created`);

    // switch back to My Workspace via the switcher
    await switchOrg('My Workspace');
    await shot(`${slug}b-switched-back`);

    // switch to Second again, rename it
    await switchOrg('Second Workspace');
    await go('/settings/organization');
    const nameInput = page.locator('input').first();
    await nameInput.fill('Renamed Workspace');
    await page.click('button:has-text("Save changes")');
    await page.locator('header button', { hasText: 'Renamed Workspace' }).first().waitFor({ timeout: 15000 });
    await shot(`${slug}c-renamed`);

    // scoping: projects list is empty under the second workspace
    await go('/projects');
    const projText = await page.locator('main, body').first().innerText();
    assert(/No projects yet/i.test(projText), `expected empty projects in 2nd ws: ${projText.slice(0, 200)}`);

    // switch back to the default workspace, then return and delete the second
    await switchOrg('My Workspace');
    await switchOrg('Renamed Workspace');
    await go('/settings/organization');
    await page.locator('input').nth(2).fill('Renamed Workspace');
    await page.click('button:has-text("Delete workspace")');
    await page.locator('header button', { hasText: 'My Workspace' }).first().waitFor({ timeout: 20000 });
    const after = await page.locator('header').innerText();
    assert(!/Renamed Workspace/.test(after), 'deleted workspace still in switcher');
    return 'create → switch → rename → scoped lists → delete all worked';
  });

  // ------------------------------------------------------------------ 4 ---
  await step(4, 'projects-and-teams', async (slug) => {
    await go('/projects');
    await page.click('button:has-text("New project")');
    await page.fill('#project-name', 'Live E2E Project');
    await page.fill('#project-description', 'created by the live driver');
    await page.locator('button[type=submit]:has-text("Create")').first().click();
    await page.locator('text=Live E2E Project').first().waitFor({ timeout: 15000 });
    await shot(`${slug}a-project`);

    await go('/teams');
    await page.click('button:has-text("New team")');
    await page.fill('#team-name', 'Live E2E Team');
    await page.fill('#team-description', 'created by the live driver');
    await page.locator('button[type=submit]:has-text("Create")').first().click();
    await page.locator('text=Live E2E Team').first().waitFor({ timeout: 15000 });
    return 'project + team created through the UI';
  });

  // ------------------------------------------------------------------ 5 ---
  await step(5, 'schedule-wizard', async (slug) => {
    await go('/schedules/new');
    await page.locator('text=What should these briefs cover?').waitFor({ timeout: 15000 });
    await shot(`${slug}a-step1-scope`);
    await page.click('button:has-text("Continue")');
    await page.locator('text=How often should it go out?').waitFor({ timeout: 15000 });
    await shot(`${slug}b-step2-cadence`);
    await page.click('button:has-text("Continue")');
    await page.locator('text=Where should it go').waitFor({ timeout: 15000 });
    // No backfill: every backfilled brief is a real OpenAI call.
    await page.locator('button:has-text("None")').first().click();
    await shot(`${slug}c-step3-delivery`);
    await page.click('button:has-text("Create schedule")');
    await page.locator('text=is live').waitFor({ timeout: 20000 });
    await shot(`${slug}d-created`);

    // `/schedules` is behind `useConnectReposGate` until a repository is
    // synced, so pause/delete happen on the (ungated) detail route. Same UI
    // controls, same requests — only the way in is a URL rather than a click.
    const list = () => api('/api/organizations/current/brief-schedules');

    const created = await list();
    assert(created.length === 1, `expected 1 schedule, got ${created.length}`);
    await go(`/schedules/${created[0].id}`);
    await page.locator('button:has-text("Pause")').first().click();
    await page.locator('button:has-text("Resume")').first().waitFor({ timeout: 15000 });
    await shot(`${slug}e-paused`);
    assert((await list())[0].paused === true, 'pause did not persist');

    await page.locator('button:has-text("Delete")').first().click();
    await page.locator('[role=alertdialog]').waitFor({ timeout: 10000 });
    await page.locator('[role=alertdialog] button:has-text("Delete")').last().click();
    await sleep(2500);
    const left = await list();
    assert(left.length === 0, `schedule survived delete (${left.length} left)`);
    return 'wizard 3 steps rendered; created (project scope) → paused → deleted';
  });

  // ------------------------------------------------------------------ 6 ---
  await step(6, 'briefs-page', async () => {
    await go('/briefs');
    const txt = await page.locator('body').innerText();
    assert(txt.trim().length > 0, 'briefs page blank');
    assert(!/something went wrong|application error/i.test(txt), `briefs page errored: ${txt.slice(0, 300)}`);
    return `rendered: "${txt.split('\n').filter(Boolean).slice(0, 3).join(' / ').slice(0, 120)}"`;
  });

  // ------------------------------------------------------------------ 7 ---
  await step(7, 'settings', async (slug) => {
    await go('/settings');
    await page.locator('#openai-key').waitFor({ timeout: 15000 });

    // data directory shown
    const bodyBefore = await page.locator('body').innerText();
    assert(bodyBefore.includes(USER_DATA), `data dir not shown (want ${USER_DATA})`);
    assert(/Tokens used/.test(bodyBefore), 'usage totals missing');

    // OpenAI key → configured
    await page.fill('#openai-key', 'sk-live-e2e-driver-key');
    await page.click('button:has-text("Save key")');
    await sleep(2500);
    const openaiCard = page.locator('div').filter({ hasText: /^OpenAI/ });
    await shot(`${slug}a-openai-saved`);
    const after = await page.locator('body').innerText();
    assert(/Configured/i.test(after), 'no Configured pill after saving key');

    // models
    await page.fill('#openai-analysis-model', 'gpt-4.1-mini');
    await page.fill('#openai-brief-model', 'gpt-4.1');
    await page.click('button:has-text("Save models")');
    await sleep(2000);
    const modelTxt = await page.locator('body').innerText();
    assert(/gpt-4\.1-mini/.test(modelTxt) && /gpt-4\.1/.test(modelTxt), 'model override not reflected');
    await shot(`${slug}b-models-saved`);

    // SMTP — verified against the local fake, because the backend refuses to
    // store credentials whose `transporter.verify()` did not succeed.
    await page.fill('#smtp-host', '127.0.0.1');
    await page.fill('#smtp-port', String(SMTP_PORT));
    await page.fill('#smtp-user', 'e2e@example.com');
    await page.fill('#smtp-pass', 'hunter2');
    await page.fill('#smtp-from', 'DevSummary <e2e@example.com>');
    await page.click('button:has-text("Save and verify")');
    await sleep(6000);
    await shot(`${slug}c-smtp`);
    const smtpTxt = await page.locator('body').innerText();
    assert(
      (smtpTxt.match(/Configured/gi) ?? []).length >= 2,
      `SMTP did not flip to Configured: ${(smtpTxt.match(/SMTP[^\n]*/i) ?? [''])[0]}`,
    );

    // desktop notifications toggle
    const sw = page.locator('button[role=switch][aria-label="Desktop notifications"]');
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await sleep(2000);
    const afterState = await sw.getAttribute('aria-checked');
    assert(before !== afterState, `notification switch did not flip (${before} → ${afterState})`);
    await shot(`${slug}d-notifications`);
    return `key→Configured, models saved, smtp submitted (${/saved/i.test(smtpTxt) ? 'ok' : 'see shot'}), notif ${before}→${afterState}, dataDir shown`;
  });

  // ------------------------------------------------------------------ 8 ---
  await step(8, 'github-integration', async (slug) => {
    await go('/integrations/github');
    await page.locator('#github-pat').waitFor({ timeout: 15000 });
    const txt = await page.locator('body').innerText();
    assert(/Contents/.test(txt) && /Metadata/.test(txt), `permissions list missing: ${txt.slice(0, 300)}`);
    await shot(`${slug}a-form`);
    await page.fill('#github-pat', 'github_pat_definitely_not_a_real_token');
    await page.click('button:has-text("Connect GitHub")');
    const toast = page.locator('[data-sonner-toast]').first();
    await toast.waitFor({ timeout: 20000 });
    const message = await toast.innerText();
    const type = await toast.getAttribute('data-type');
    await shot(`${slug}b-rejected`);
    assert(type === 'error', `expected an error toast, got ${type}: ${message}`);
    assert(await page.locator('#github-pat').count(), 'app navigated away / crashed on bad token');
    const installs = await api('/api/integrations/github');
    assert(installs.length === 0, `a rejected token still created ${installs.length} installation(s)`);
    return `rejected gracefully: "${message.replace(/\n/g, ' ').slice(0, 130)}"`;
  });

  // ------------------------------------------------------------------ 9 ---
  await step(9, 'slack-integration', async (slug) => {
    await go('/integrations/slack');
    await sleep(1500);
    const input = page.locator('input[type=password], input[placeholder^="xoxb"]').first();
    await input.waitFor({ timeout: 15000 });
    await shot(`${slug}a-form`);
    await input.fill('xoxb-not-a-real-token');
    await page.locator('button:has-text("Connect")').first().click();
    const toast = page.locator('[data-sonner-toast]').first();
    await toast.waitFor({ timeout: 20000 });
    const message = await toast.innerText();
    const type = await toast.getAttribute('data-type');
    await shot(`${slug}b-rejected`);
    assert(type === 'error', `expected an error toast, got ${type}: ${message}`);
    assert(await input.count(), 'slack form vanished / crashed');
    return `rejected gracefully: "${message.replace(/\n/g, ' ').slice(0, 130)}"`;
  });

  // ----------------------------------------------------------------- 11 ---
  await step(11, 'external-link-no-new-window', async () => {
    await go('/integrations/github');
    const before = app.windows().length;
    await page.locator('a[target=_blank]:has-text("Create a token")').first().click();
    await sleep(3000);
    const after = app.windows().length;
    assert(after === before, `a new Electron window opened (${before} → ${after})`);
    assert(page.url().startsWith('http://localhost:5173'), `renderer navigated away: ${page.url()}`);
    return `windows ${before} → ${after}; renderer stayed on ${page.url()}`;
  });

  // ----------------------------------------------------------------- 10 ---
  const boot1 = boot1Log();
  writeFileSync(path.join(HERE, 'backend-boot1.log'), boot1);
  await app.close();
  await sleep(2000);

  [app, page] = await launch('boot 2');
  await step(10, 'persistence-across-restart', async (slug) => {
    await page.locator('header button', { hasText: 'My Workspace' }).first().waitFor({ timeout: 20000 });
    await go('/projects');
    assert(
      (await page.locator('body').innerText()).includes('Live E2E Project'),
      'project did not survive restart',
    );
    await shot(`${slug}a-project`);
    await go('/teams');
    assert(
      (await page.locator('body').innerText()).includes('Live E2E Team'),
      'team did not survive restart',
    );
    // Nothing in this run ever pasted a working GitHub token, so anything in
    // here would be a credential the app accepted that it should not have.
    const installs = await api('/api/integrations/github');
    assert(installs.length === 0, `unexpected github installation(s): ${JSON.stringify(installs)}`);

    await go('/settings');
    await page.locator('#openai-key').waitFor({ timeout: 15000 });
    const s = await page.locator('body').innerText();
    assert(/gpt-4\.1-mini/.test(s), 'model override did not survive restart');
    assert(/Configured/i.test(s), 'openai key flag did not survive restart');
    await shot(`${slug}b-settings`);

    writeFileSync(path.join(HERE, 'backend-boot2.log'), logBuf);
    const m = logBuf.match(/applied (\d+) migration\(s\)|database up to date/);
    assert(m, `no migration line in boot-2 log:\n${logBuf.slice(-2000)}`);
    assert(
      m[0] === 'database up to date' || m[1] === '0',
      `boot 2 applied migrations: ${m[0]}`,
    );
    assert(/applied 16 migration|applied \d+ migration/.test(boot1), 'boot 1 did not report applied migrations');
    return `data + settings survived; boot1="${(boot1.match(/applied \d+ migration\(s\)/) ?? [''])[0]}" boot2="${m[0]}"`;
  });

  // ----------------------------------------------------------------- 12 ---
  await step(12, 'backend-crash-recovery', async (slug) => {
    const before = await apiConfig();
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${before.port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    }).trim().split('\n')[0];
    assert(pid, 'could not find backend pid');
    execFileSync('kill', ['-9', pid]);
    console.log(`killed backend pid ${pid} (port ${before.port})`);
    await sleep(12000);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(4000);
    const after = await apiConfig();
    assert(after.port !== before.port, `backend did not rebind (${before.port} → ${after.port})`);
    await go('/projects');
    assert(
      (await page.locator('body').innerText()).includes('Live E2E Project'),
      'data missing after crash recovery',
    );
    await shot(`${slug}a-recovered`);
    return `killed pid ${pid}; rebound ${before.port} → ${after.port}; data intact`;
  });

  writeFileSync(path.join(HERE, 'backend-boot2.log'), logBuf);
  await app.close();
  smtp.close();
  writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\n===== SUMMARY =====');
  for (const r of results) console.log(`${r.status}  ${r.n} ${r.name}  ${r.note.slice(0, 160)}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
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
