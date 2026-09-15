// The renderer's Content-Security-Policy, checked in the one engine that can
// answer: the policy is a meta tag (a file:// document has no response headers
// to put one in), and its hashes are computed at build time from the emitted
// HTML, so nothing but a real load proves the app still starts under it.
//
// Chromium on its own is not a substitute — it refuses file:// module scripts by
// CORS before CSP is ever consulted, so the page fails to mount either way.
//
//   pnpm --filter frontend build && pnpm --filter desktop test:csp
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const INDEX = path.join(__dirname, '../../frontend/dist/index.html');

let failures = 0;
function check(label, pass, detail) {
  if (!pass) failures += 1;
  // Detail on failure only: these are long CSP console lines, and a passing
  // check that prints its failure hint reads as a failure.
  console.log(`[csp] ${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? ` — ${detail}` : ''}`);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    // The shipped window's settings, minus the preload: this checks the policy,
    // not the IPC bridge, and an absent `window.desktop` still renders.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const violations = [];
  win.webContents.on('console-message', (event) => {
    if (/Content Security Policy/i.test(event.message)) violations.push(event.message);
  });

  const js = (code) => win.webContents.executeJavaScript(code);

  try {
    await win.loadFile(INDEX);
    await delay(4000);

    check(
      'a policy is present',
      await js(
        `Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]'))`,
      ),
      'run `pnpm --filter frontend build` first',
    );

    // The regression that matters most: a policy that blocks the app's own
    // bundle is a blank window, which is exactly how §1 failure 3 presented.
    check(
      'the app still mounts under it',
      (await js("document.getElementById('root')?.childElementCount ?? 0")) > 0,
      'renderer did not render',
    );
    check(
      'its own stylesheet and fonts still load',
      /Hanken Grotesk/.test(await js('getComputedStyle(document.body).fontFamily')),
      await js('getComputedStyle(document.body).fontFamily'),
    );

    // Enforced, not merely declared.
    check(
      'a remote script is refused',
      (await js(`new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://example.com/evil.js';
        s.onload = () => resolve('loaded');
        s.onerror = () => resolve('blocked');
        setTimeout(() => resolve('blocked'), 1500);
        document.head.appendChild(s);
      })`)) === 'blocked',
    );
    check(
      'a fetch to a remote origin is refused',
      (await js(
        "fetch('https://example.com/').then(() => 'allowed', () => 'blocked')",
      )) === 'blocked',
    );

    // The one origin the renderer must keep: the backend's loopback port. A
    // connection refused by the OS is the pass — a *policy* refusal logs a
    // console violation naming connect-src, which is what this looks for.
    // Only violations raised *after* this point count: the connect-src refusal
    // above quotes the whole directive, `http://127.0.0.1:*` included, so a
    // substring search over every message matches its own allow-list entry.
    const before = violations.length;
    await js("fetch('http://127.0.0.1:59999/ping').catch(() => {})");
    await delay(500);
    const afterLoopback = violations.slice(before);
    check(
      'loopback is not blocked by the policy',
      afterLoopback.length === 0,
      afterLoopback.join(' | '),
    );

    // A directive Chromium ignores in a meta tag is a line of console noise on
    // every launch and a false sense of coverage.
    check(
      'no directive is ignored in meta',
      !violations.some((m) => /is ignored when delivered via a <meta> element/.test(m)),
      violations.join(' | '),
    );
  } catch (err) {
    check('driver', false, String(err));
  }

  console.log(`[csp] ${failures} failing check(s)`);
  app.exit(failures === 0 ? 0 : 1);
});
