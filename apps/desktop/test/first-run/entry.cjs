// Electron entry for the first-run driver. Same trick as `apps/desktop/test/drive.js`:
// point `userData` somewhere empty *before* the real main runs, then load the real
// compiled main — nothing about the app under test is stubbed.
//
//   FIRST_RUN_USERDATA=<dir> electron apps/desktop/test/first-run/entry.cjs
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const userData = process.env.FIRST_RUN_USERDATA;
if (!userData) throw new Error('FIRST_RUN_USERDATA is required');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

require(path.join(__dirname, '../../../../../apps/desktop/dist/main.js'));
