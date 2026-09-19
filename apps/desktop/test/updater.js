// The updater's pure parts. Everything stateful in updater.ts is one
// autoUpdater event handler wide; what is worth checking is the reduction
// those handlers feed, the preference file's tolerance for being absent or
// corrupt, and the platform branch that keeps macOS off the install path.
//
//   pnpm --filter desktop build && pnpm --filter desktop test:updater
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const { reduce, loadPreference, savePreference, canInstallInPlace } = require('../dist/updater.js');

let failures = 0;
function check(label, pass, detail) {
  if (!pass) failures += 1;
  console.log(`[updater] ${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? ` — ${detail}` : ''}`);
}

const idle = { status: 'idle' };

check(
  'an available update becomes available',
  reduce(idle, { type: 'available', version: '0.2.0' }).status === 'available',
);

check(
  'progress carries a rounded percent',
  reduce(idle, { type: 'progress', percent: 41.7 }).percent === 42,
);

check(
  'a finished download becomes ready with its version',
  reduce(idle, { type: 'downloaded', version: '0.2.0' }).version === '0.2.0',
);

// The one rule that is not obvious: an installer already on disk stays
// offerable. A 6-hourly re-check that answers "none", or a transient offline
// error, must not take the Restart button away from a user who has the update.
const ready = { status: 'ready', version: '0.2.0' };
check('a later "none" does not clear a ready update', reduce(ready, { type: 'none' }).status === 'ready');
check(
  'a later error does not clear a ready update',
  reduce(ready, { type: 'error', message: 'offline' }).status === 'ready',
);

check('an error is a state, with its message', reduce(idle, { type: 'error', message: 'offline' }).message === 'offline');

// Preference file: three ways to read it, one of which is the happy path.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsummary-updates-'));
const file = path.join(dir, 'updates.json');

check('a missing updates.json means updates are on', loadPreference(file) === true);

fs.writeFileSync(file, '{ not json');
check('an unreadable updates.json means updates are on', loadPreference(file) === true);

savePreference(file, false);
check('a saved preference reads back', loadPreference(file) === false);
check('the preference file is owner-only', (fs.statSync(file).mode & 0o777) === 0o600);

// macOS: Squirrel.Mac validates the update's signature against the running
// app's, and every ad-hoc build has a different cdhash. Nothing may route a
// darwin user into quitAndInstall until there is a Developer ID.
check('darwin cannot install in place', canInstallInPlace('darwin') === false);
check('win32 can install in place', canInstallInPlace('win32') === true);
check('linux can install in place', canInstallInPlace('linux') === true);

// An AppImage owns its own file and replaces it; a deb belongs to apt, which is
// already going to upgrade it. Installing over apt's copy means a pkexec prompt
// for work the package manager had in hand.
check('an AppImage can install in place', canInstallInPlace('linux', null) === true);
check('an apt-managed deb cannot', canInstallInPlace('linux', 'deb') === false);
check('nor can an rpm', canInstallInPlace('linux', 'rpm') === false);

fs.rmSync(dir, { recursive: true, force: true });
app.exit(failures === 0 ? 0 : 1);
