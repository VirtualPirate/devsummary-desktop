import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  shell,
  utilityProcess,
} from 'electron';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Per-boot bearer token for the loopback API (plan D9). Regenerated every launch
 * and never written to disk — the renderer gets it over IPC, the backend gets it
 * as env at fork time, and `LocalTokenGuard` compares it with `timingSafeEqual`.
 */
const API_TOKEN = randomBytes(32).toString('hex');

/** Vite's dev server. Also the app's own origin in dev, so link handling keys off it. */
const DEV_URL = 'http://localhost:5173';

/**
 * `FRONTEND_URL` is `getOrThrow` inside both leaf senders (email + Slack) at send
 * time, so it must always be set or every delivery fails with an opaque config
 * error. In dev it is the real dev server; packaged there is no HTTP origin at
 * all (the renderer is loaded from disk), so a placeholder stands in — the links
 * in a delivered brief point at a machine the recipient does not have anyway.
 */
const PROD_FRONTEND_URL = 'app://local';

/** Overridable so the Phase-8 harness can fork a fake backend. */
const BACKEND_ENTRY =
  process.env.DESKTOP_BACKEND_ENTRY ??
  path.join(__dirname, '../../backend/dist/main.js');

type SecretBundle = Record<string, string>;

let secrets: SecretBundle = {};
let apiPort: number | null = null;
let portReady: Promise<number> = new Promise(() => {});
let announcePort: (port: number) => void = () => {};
let restarts = 0;
let quitting = false;

// ---------------------------------------------------------------- secrets ---

const secretsFile = () => path.join(app.getPath('userData'), 'secrets.bin');

function saveSecrets(bundle: SecretBundle): void {
  secrets = bundle;
  if (!safeStorage.isEncryptionAvailable()) {
    // ponytail: no OS keychain (headless Linux, no gnome-keyring) means the
    // bundle lives in memory for this boot only. Upgrade path: surface it in the
    // settings screen instead of a log line, once anyone runs this on such a box.
    console.warn('[desktop] safeStorage unavailable — secrets not persisted');
    return;
  }
  writeFileSync(secretsFile(), safeStorage.encryptString(JSON.stringify(bundle)), {
    mode: 0o600,
  });
}

/**
 * The DB encryption key protects the stored GitHub PAT and Slack bot token, so it
 * must be generated exactly once and then stay stable across launches — it lives
 * in the same encrypted bundle as the credentials it protects.
 */
function loadSecrets(): SecretBundle {
  let bundle: SecretBundle = {};
  try {
    bundle = JSON.parse(safeStorage.decryptString(readFileSync(secretsFile()))) as SecretBundle;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // A blob written under a different keychain entry cannot be recovered, so
      // starting fresh loses nothing that was still readable. Say so loudly.
      console.error(`[desktop] secrets.bin unreadable, starting fresh: ${String(err)}`);
    }
  }
  if (!bundle.DB_ENCRYPTION_KEY) {
    bundle.DB_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    saveSecrets(bundle);
  }
  return bundle;
}

// ---------------------------------------------------------------- backend ---

function onBackendMessage(message: unknown): void {
  const msg = message as {
    port?: number;
    type?: string;
    bundle?: SecretBundle;
    title?: string;
    body?: string;
  };

  if (typeof msg?.port === 'number') {
    apiPort = msg.port;
    announcePort(msg.port);
    // A restarted backend binds a *different* free port. The renderer read the
    // old one once at boot, so without a reload the recovery is invisible and
    // every request still goes to a dead port.
    if (restarts > 0) {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.reload();
    }
    return;
  }

  switch (msg?.type) {
    case 'secrets:save':
      if (msg.bundle) saveSecrets(msg.bundle);
      return;
    case 'notification':
      if (!Notification.isSupported()) return;
      new Notification({ title: msg.title ?? 'DevSummary', body: msg.body ?? '' }).show();
      return;
    default:
      console.warn(`[desktop] unknown backend message: ${JSON.stringify(message)}`);
  }
}

function startBackend(): void {
  // Reset before every fork: the OS hands the new process a different free port,
  // so anything waiting must wait for *this* backend's announcement.
  apiPort = null;
  portReady = new Promise<number>((resolve) => {
    announcePort = resolve;
  });

  const child = utilityProcess.fork(BACKEND_ENTRY, [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: app.isPackaged ? 'production' : 'development',
      API_TOKEN,
      DATA_DIR: app.getPath('userData'),
      PORT: '0',
      FRONTEND_URL: app.isPackaged ? PROD_FRONTEND_URL : DEV_URL,
      ...secrets,
    },
  });

  child.on('message', onBackendMessage);

  child.on('exit', (code) => {
    if (quitting || code === 0) return;
    if (restarts++ < 1) {
      console.error(`[desktop] backend exited with ${code}; restarting once`);
      startBackend();
      return;
    }
    dialog.showErrorBox(
      'DevSummary',
      'The background service stopped and could not be restarted. Please quit and reopen DevSummary.',
    );
  });
}

// ----------------------------------------------------------------- window ---

/** http(s) that is not our own dev origin. Packaged, the app is `file://`, so every http(s) URL is external. */
function isExternal(url: string): boolean {
  return /^https?:/i.test(url) && !url.startsWith(DEV_URL);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DevSummary',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // GitHub commit links are `target="_blank"`; they belong in the system browser,
  // not in a chrome-less Electron window with no way back.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isExternal(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  void (app.isPackaged
    ? win.loadFile(path.join(__dirname, '../../frontend/dist/index.html'))
    : win.loadURL(DEV_URL));

  return win;
}

// -------------------------------------------------------------------- IPC ---

ipcMain.handle('api:config', async () => ({
  port: apiPort ?? (await portReady),
  token: API_TOKEN,
}));

ipcMain.handle('shell:open-external', async (_event, url: unknown) => {
  // Trust boundary: the renderer must not be able to hand the OS a `file://`
  // path or a custom-scheme handler.
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refusing to open ${parsed.protocol} externally`);
  }
  await shell.openExternal(parsed.href);
});

// --------------------------------------------------------------- lifecycle ---

// Two instances would open the same PGlite data directory. That is data loss,
// not an inconvenience.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  void app.whenReady().then(() => {
    secrets = loadSecrets();
    startBackend();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
