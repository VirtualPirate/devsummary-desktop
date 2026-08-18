// Phase-8 verification harness. Stands in for apps/backend/dist/main.js so the
// fork/IPC/secrets/restart mechanics can be checked while the real backend is
// still mid-migration. Not shipped, not referenced by src/.
const assert = require('node:assert');

const required = ['API_TOKEN', 'DATA_DIR', 'PORT', 'FRONTEND_URL', 'DB_ENCRYPTION_KEY', 'NODE_ENV'];
for (const key of required) {
  assert.ok(process.env[key], `fork env is missing ${key}`);
}
assert.match(process.env.API_TOKEN, /^[0-9a-f]{64}$/, 'API_TOKEN is not 32 random bytes of hex');
assert.strictEqual(process.env.PORT, '0', 'PORT must be 0 so the OS picks a free one');

console.log(
  '[fake-backend] fork env ok ' +
    JSON.stringify({
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      FRONTEND_URL: process.env.FRONTEND_URL,
      DATA_DIR: process.env.DATA_DIR,
      API_TOKEN: `${process.env.API_TOKEN.slice(0, 8)}… (len ${process.env.API_TOKEN.length})`,
      DB_ENCRYPTION_KEY_LEN: process.env.DB_ENCRYPTION_KEY.length,
      SMTP_HOST: process.env.SMTP_HOST ?? '(unset)',
    }),
);

if (process.env.FAKE_BACKEND_MODE === 'crash') {
  // The exit code is a parameter: an exit the shell did not ask for is a crash
  // whatever the code says, and `FAKE_BACKEND_EXIT_CODE=0` is the case that used
  // to be ignored outright — leaving the window pointed at a dead port.
  const code = Number(process.env.FAKE_BACKEND_EXIT_CODE ?? 1);
  process.parentPort.postMessage({ port: 45678 });
  console.log(`[fake-backend] crash mode — exiting(${code}) in 300ms`);
  setTimeout(() => process.exit(code), 300);
} else {
  // 1. the port announcement the main process must await
  process.parentPort.postMessage({ port: 45678 });

  // 2. the SecretsService.update() round trip: whole merged bundle back to main
  process.parentPort.postMessage({
    type: 'secrets:save',
    bundle: {
      DB_ENCRYPTION_KEY: process.env.DB_ENCRYPTION_KEY,
      SMTP_HOST: 'smtp.example.test',
      SMTP_USER: 'harness@example.test',
      SMTP_PASS: 'harness-password',
    },
  });

  // 3. the desktop delivery channel
  process.parentPort.postMessage({
    type: 'notification',
    title: 'Weekly brief ready',
    body: 'Phase 8 harness notification body',
    briefId: '00000000-0000-4000-8000-000000000001',
  });

  setInterval(() => {}, 60_000);
}
