// @nestjs/common's decorators need the polyfill, and nothing in a DB-only
// spec's import graph pulls @nestjs/core (which loads it for the app specs).
import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { vi } from 'vitest';
import { E2E_API_TOKEN } from './harness/api';

// Must run before any import of src/app.module. ConfigModule.forRoot reads
// apps/backend/.env from cwd; without this, tests would boot against whatever
// the developer's .env holds. dotenv never overwrites an already-set key, so
// these values win and the dev .env can only fill gaps.
loadEnv({ path: fileURLToPath(new URL('../../.env.test', import.meta.url)) });

// LocalTokenGuard reads this once, when DI constructs it. Set from the same
// constant the request helper sends, so the two cannot drift.
process.env.API_TOKEN = E2E_API_TOKEN;

// vitest.e2e.config.ts aliases @octokit/*, @slack/web-api, nodemailer and
// openai to src/__mocks__/ — the same files Jest loads through
// moduleNameMapper, so they are written against the `jest` global. `vi` is
// API-compatible for everything they use (fn, mockReset, mockImplementation).
// This must land before the first aliased module is evaluated, which it does:
// setup files run before the test file's imports.
(globalThis as { jest?: unknown }).jest = vi;
