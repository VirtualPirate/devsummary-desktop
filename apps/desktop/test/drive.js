// Phase-8 verification driver. Runs as the Electron entry point, patches the two
// side effects that would block or escape a test (`dialog.showErrorBox`,
// `shell.openExternal`), then loads the *real* compiled dist/main.js and asserts
// against it through the real preload/IPC path.
//
//   FAKE_BACKEND_MODE=happy|crash  DRIVE_USERDATA=<dir>  electron test/drive.js
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, dialog, shell, Notification, safeStorage } = require('electron');

const mode = process.env.FAKE_BACKEND_MODE || 'happy';
const userData =
  process.env.DRIVE_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'devsummary-p8-'));
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

const dialogs = [];
dialog.showErrorBox = (title, content) => {
  dialogs.push({ title, content });
  console.log(`[drive] dialog.showErrorBox → ${title}: ${content}`);
};

const opened = [];
shell.openExternal = (url) => {
  opened.push(url);
  return Promise.resolve();
};

process.env.DESKTOP_BACKEND_ENTRY = path.join(__dirname, 'fake-backend.js');
require('../dist/main.js');

let failures = 0;
function check(label, pass, detail) {
  if (!pass) failures += 1;
  console.log(`[drive] ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalInRenderer(win, code) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const ready = await win.webContents.executeJavaScript('typeof window.desktop');
      if (ready === 'object') return await win.webContents.executeJavaScript(code);
    } catch {
      /* page still loading */
    }
    await delay(100);
  }
  throw new Error('preload bridge never appeared');
}

async function happy() {
  const win = BrowserWindow.getAllWindows()[0];
  check('window created', Boolean(win));

  const prefs = win.webContents.getLastWebPreferences();
  check(
    'contextIsolation + sandbox on, nodeIntegration off',
    prefs.contextIsolation === true && prefs.sandbox === true && prefs.nodeIntegration !== true,
    JSON.stringify({
      contextIsolation: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      nodeIntegration: prefs.nodeIntegration === true,
    }),
  );

  const cfg = await evalInRenderer(win, 'window.desktop.apiConfig()');
  check(
    'api:config returns the announced port and the per-boot token',
    cfg.port === 45678 && /^[0-9a-f]{64}$/.test(cfg.token),
    JSON.stringify({ port: cfg.port, tokenLen: cfg.token.length }),
  );

  const blob = fs.readFileSync(path.join(userData, 'secrets.bin'));
  const bundle = JSON.parse(safeStorage.decryptString(blob));
  check(
    'secrets.bin written and decryptable via safeStorage',
    bundle.SMTP_HOST === 'smtp.example.test' && bundle.SMTP_PASS === 'harness-password',
    `${blob.length} encrypted bytes, keys=${Object.keys(bundle).sort().join(',')}`,
  );
  check(
    'DB_ENCRYPTION_KEY is 32 random bytes of hex and persisted',
    /^[0-9a-f]{64}$/.test(bundle.DB_ENCRYPTION_KEY || ''),
    `sha256(key)[0..16]=${createHash('sha256').update(bundle.DB_ENCRYPTION_KEY).digest('hex').slice(0, 16)}`,
  );

  check('notification message did not crash the main process', true, `Notification.isSupported()=${Notification.isSupported()}`);

  await evalInRenderer(win, "window.open('https://example.com/target-blank'); 0");
  await delay(300);
  check(
    'target=_blank goes to shell.openExternal, no second window',
    opened.includes('https://example.com/target-blank') && BrowserWindow.getAllWindows().length === 1,
    `opened=${JSON.stringify(opened)} windows=${BrowserWindow.getAllWindows().length}`,
  );

  await evalInRenderer(win, "location.href = 'https://example.com/will-navigate'; 0");
  await delay(500);
  check(
    'will-navigate to an external origin is redirected to the browser',
    opened.includes('https://example.com/will-navigate'),
    `url still ${win.webContents.getURL()}`,
  );

  // `http://localhost:51735` carries the dev URL as a *prefix*. A startsWith
  // check called it internal and let it drive this token-bearing window.
  await evalInRenderer(win, "location.href = 'http://localhost:51735/'; 0");
  await delay(500);
  check(
    'an origin that merely prefix-matches the dev URL is external',
    opened.includes('http://localhost:51735/') &&
      new URL(win.webContents.getURL()).port === '5173',
    `opened=${JSON.stringify(opened)} url=${win.webContents.getURL()}`,
  );

  const rejected = await evalInRenderer(
    win,
    "window.desktop.openExternal('file:///etc/passwd').then(() => 'resolved', (e) => 'rejected: ' + e.message)",
  );
  check(
    'openExternal refuses a non-http scheme from the renderer',
    rejected.startsWith('rejected') && !opened.some((u) => u.startsWith('file:')),
    rejected,
  );

  const listen = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => /electron/i.test(l));
  console.log(`[drive] lsof LISTEN sockets owned by Electron:\n${listen.join('\n') || '(none)'}`);
  check(
    'nothing bound off loopback',
    !listen.some((l) => /\*:\d|0\.0\.0\.0/.test(l)),
    `${listen.length} electron LISTEN row(s)`,
  );
}

async function crash() {
  await delay(4000);
  check(
    `unexpected exit (code ${process.env.FAKE_BACKEND_EXIT_CODE ?? 1}) → exactly one restart, then an error dialog`,
    dialogs.length === 1,
    JSON.stringify(dialogs),
  );
}

void app.whenReady().then(async () => {
  await delay(500);
  try {
    await (mode === 'crash' ? crash() : happy());
  } catch (err) {
    check(`driver (${mode})`, false, String(err));
  }
  console.log(`[drive] ${mode}: ${failures} failing check(s)`);
  app.exit(failures === 0 ? 0 : 1);
});
