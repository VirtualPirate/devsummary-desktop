import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { inject, vi } from 'vitest';

// Must run before any import of src/app.module. ConfigModule.forRoot reads
// apps/backend/.env from cwd; without this, tests would boot against the dev
// database on port 11753 and mutate it. dotenv never overwrites an
// already-set key, so these values win and the dev .env can only fill gaps.
loadEnv({ path: fileURLToPath(new URL('../../.env.test', import.meta.url)) });

// Set before any import of src/app.module: TemporalModule.forRoot() calls
// Connection.connect() eagerly in a useFactory, so the app connects for real
// to the dev server rather than to a mocked client.
process.env.TEMPORAL_ADDRESS = inject('temporalAddress');

// A module mock, not a DI override: `new Resend(...)` is called directly at
// five non-injectable sites — auth/auth.config.ts, auth/email-otp.service.ts,
// organizations/services/invite-mailer.ts,
// briefs/delivery/services/brief-email.service.ts, and
// waitlist/waitlist.service.ts. Only a module-level mock reaches all of them,
// and it needs no edit when a sixth site appears.
vi.mock('resend', async () => {
  const { ResendMock } = await import('./harness/resend-mock');
  return { Resend: ResendMock };
});
