import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';

/**
 * Where a mac user is sent instead of an in-app install. Squirrel.Mac checks
 * that an update's code signature matches the running app's, and this project
 * ad-hoc signs (`mac.identity: "-"`), which mints a fresh cdhash per build — so
 * every mac update would fail validation. mac notifies; the browser does the
 * rest. See the spec's §7 for the three-line flip once a Developer ID exists.
 */
export const RELEASES_URL = 'https://github.com/VirtualPirate/devsummary-desktop/releases/latest';

/** Off the critical launch path, which is ~10 s to a usable window. */
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'none' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

export interface UpdateSnapshot {
  state: UpdateState;
  currentVersion: string;
  enabled: boolean;
  /** False on darwin. The renderer branches on this, never on a platform. */
  canInstall: boolean;
}

/**
 * Pure, so the interesting half of this file is testable without an
 * autoUpdater, an app or a window.
 */
export function reduce(state: UpdateState, event: UpdateEvent): UpdateState {
  // `ready` is terminal until the app restarts. An installer is on disk; a
  // 6-hourly re-check answering "none", or an offline blip, must not take the
  // Restart button away from a user who already has the update.
  if (state.status === 'ready') return state;

  switch (event.type) {
    case 'checking':
      return state.status === 'downloading' ? state : { status: 'idle' };
    case 'available':
      return { status: 'available', version: event.version };
    case 'none':
      return { status: 'idle' };
    case 'progress':
      return { status: 'downloading', percent: Math.round(event.percent) };
    case 'downloaded':
      return { status: 'ready', version: event.version };
    case 'error':
      return { status: 'error', message: event.message };
  }
}

/**
 * Squirrel.Mac cannot validate an ad-hoc signature, and a dmg is not an
 * updatable target. One function so the flag and the install branch cannot
 * disagree with each other.
 */
export const canInstallInPlace = (platform: NodeJS.Platform): boolean => platform !== 'darwin';

/**
 * Plain JSON in userData, the same shape and the same tolerance as
 * `consent.json` in main.ts: a boolean is not a secret, so no safeStorage, and
 * a file this app cannot read is not a reason to stop checking for updates.
 *
 * Deliberately not in the backend's settings table — the updater has to work
 * when the backend failed to boot, and the launch check must not wait on a
 * utilityProcess fork and 16 migrations.
 */
export function loadPreference(file: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { enabled?: unknown };
    return typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.error(`[updates] updates.json unreadable, assuming on: ${String(err)}`);
    }
    return true;
  }
}

export function savePreference(file: string, enabled: boolean): void {
  writeFileSync(file, JSON.stringify({ enabled }), { mode: 0o600 });
  // `mode` is the O_CREAT mode: node ignores it when the file already exists, so
  // a updates.json that arrived any other way (an older build, a restored
  // backup) would keep its looser permissions forever. chmod every time.
  chmodSync(file, 0o600);
}

let state: UpdateState = { status: 'idle' };
let enabled = true;
let timer: NodeJS.Timeout | null = null;

const prefFile = () => path.join(app.getPath('userData'), 'updates.json');

const snapshot = (): UpdateSnapshot => ({
  state,
  currentVersion: app.getVersion(),
  enabled,
  canInstall: canInstallInPlace(process.platform),
});

export function initUpdates(win: BrowserWindow): void {
  // Registered before the isPackaged guard below, so a `pnpm dev` renderer gets
  // a working idle snapshot instead of "No handler registered for
  // 'updates:state'".
  ipcMain.handle('updates:state', () => snapshot());

  ipcMain.handle('updates:check', async () => {
    await check();
    return snapshot();
  });

  ipcMain.handle('updates:preference', async (_event, next: unknown) => {
    enabled = Boolean(next);
    savePreference(prefFile(), enabled);
    schedule();
    if (enabled) await check();
    return snapshot();
  });

  ipcMain.handle('updates:install', async () => {
    if (!canInstallInPlace(process.platform)) {
      await shell.openExternal(RELEASES_URL);
      return;
    }
    if (state.status !== 'ready') return;
    // Calls app.quit(), which fires `before-quit` in main.ts and sets
    // `quitting = true` — that is what stops the backend's exit handler from
    // respawning a child into an app that is on its way out.
    autoUpdater.quitAndInstall();
  });

  // Nothing to update from a checkout: no installer, no app-update.yml, and
  // `checkForUpdates` throws without one.
  if (!app.isPackaged) return;

  enabled = loadPreference(prefFile());

  // mac must never download something it cannot install.
  autoUpdater.autoDownload = canInstallInPlace(process.platform);
  // A user who never clicks Restart still gets it on their next quit.
  autoUpdater.autoInstallOnAppQuit = true;

  const apply = (event: UpdateEvent): void => {
    const next = reduce(state, event);
    if (next === state) return;
    state = next;
    if (!win.isDestroyed()) win.webContents.send('updates:changed', snapshot());
  };

  autoUpdater.on('checking-for-update', () => apply({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => apply({ type: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => apply({ type: 'none' }));
  autoUpdater.on('download-progress', (p) => apply({ type: 'progress', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => apply({ type: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => apply({ type: 'error', message: err.message }));

  function schedule(): void {
    if (timer) clearInterval(timer);
    timer = null;
    if (!enabled) return;
    timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    // Never the reason the process stays alive, matching the backend's
    // scheduler timers.
    timer.unref();
  }

  async function check(): Promise<void> {
    if (!enabled) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // Offline is the common case, not an exception. A laptop on a plane must
      // not be greeted by a modal.
      apply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref();
  schedule();
}
