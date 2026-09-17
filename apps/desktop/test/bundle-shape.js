// The packaged bundle's file count, checked against the thing that made first
// launch after install take minutes: 20,435 loose backend node_modules files in
// Contents/Resources, every one of them assessed by Gatekeeper before the app
// could start. Packing the backend into app.asar took the bundle to ~600 entries
// and first launch to ~10 s. Nothing about that is enforced by the config alone —
// one `files` entry moved back to `extraResources` undoes it silently, and the
// app still works, just slowly, and only on a machine that has never seen it.
//
//   pnpm --filter desktop dist && pnpm --filter desktop test:bundle
const fs = require('node:fs');
const path = require('node:path');

// Whichever arch this machine built. `dir`-target output lives here too.
const APP = ['release/mac-arm64/DevSummary.app', 'release/mac/DevSummary.app']
  .map((p) => path.join(__dirname, '..', p))
  .find((p) => fs.existsSync(p));

if (!APP) {
  console.error('[bundle] no packaged app under release/ — run `pnpm dist` first');
  process.exit(1);
}

const RESOURCES = path.join(APP, 'Contents/Resources');
// A loose file ceiling, not the exact count: Electron's own .lproj directories and
// helper binaries drift between versions. 20k fails, ~600 passes, and anything in
// between is worth a look.
const MAX_ENTRIES = 1500;

let failures = 0;
function check(label, pass, detail) {
  if (!pass) failures += 1;
  console.log(`[bundle] ${pass ? 'PASS' : 'FAIL'}  ${label}${!pass && detail ? ` — ${detail}` : ''}`);
}

/**
 * asar's header is a JSON listing of the archive wrapped in two Chromium pickles:
 * bytes 0-7 hold the header pickle's size, then that pickle holds its own payload
 * size (offset 0) and the JSON's length (offset 4) before the JSON itself.
 */
function readAsarHeader(archive) {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizes = Buffer.alloc(8);
    fs.readSync(fd, sizes, 0, 8, 0);
    const header = Buffer.alloc(sizes.readUInt32LE(4));
    fs.readSync(fd, header, 0, header.length, 8);
    return JSON.parse(header.subarray(8, 8 + header.readUInt32LE(4)).toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

const countEntries = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + 1 + (e.isDirectory() && !e.isSymbolicLink() ? countEntries(path.join(dir, e.name)) : 0),
    0,
  );

const inAsar = (header, relPath) =>
  relPath.split('/').reduce((node, name) => node?.files?.[name], header) !== undefined;

const asar = path.join(RESOURCES, 'app.asar');
check('app.asar exists', fs.existsSync(asar));
if (!fs.existsSync(asar)) process.exit(1);

const header = readAsarHeader(asar);

check(
  'the backend ships inside app.asar',
  inAsar(header, 'backend/dist/main.js'),
  'main.ts forks backend/dist/main.js relative to app.asar/dist',
);
check('the renderer ships inside app.asar', inAsar(header, 'frontend/dist/index.html'));
check(
  'neither child is loose in Contents/Resources',
  !fs.existsSync(path.join(RESOURCES, 'backend')) && !fs.existsSync(path.join(RESOURCES, 'frontend')),
  'a `files` entry moved back to `extraResources` — that is the minutes-long first launch',
);

// PGlite mmaps its wasm and opens .data directly; neither survives asar's
// read-only virtual FS, so these three must stay on the real filesystem.
for (const name of ['pglite.wasm', 'initdb.wasm', 'pglite.data']) {
  const unpacked = path.join(
    RESOURCES,
    'app.asar.unpacked/backend/node_modules/@electric-sql/pglite/dist',
    name,
  );
  check(`${name} is unpacked to disk`, fs.existsSync(unpacked), 'check electron-builder.yml asarUnpack');
}

// Release checklist §4: the terms, the privacy policy and the attribution for
// everything bundled have to arrive with the binary. They were links to a site
// that did not exist; a dropped `extraResources` entry would put them back there.
for (const name of ['LICENSE', 'PRIVACY.md', 'THIRD-PARTY-NOTICES.md', 'LICENSES.chromium.html']) {
  check(
    `${name} ships in Contents/Resources`,
    fs.existsSync(path.join(RESOURCES, name)),
    'check electron-builder.yml extraResources',
  );
}

const entries = countEntries(APP);
check(
  `the bundle is under ${MAX_ENTRIES} entries for Gatekeeper to assess`,
  entries <= MAX_ENTRIES,
  `${entries} entries — first launch after install pays for every one`,
);
console.log(`[bundle] ${entries} entries in ${path.relative(path.join(__dirname, '..'), APP)}`);

process.exit(failures === 0 ? 0 : 1);
