// What a throttled OpenCode Zen call looks like from
// the app's side, through the COMPILED backend and the real `opencode`.
//
//   node apps/backend/test/agent-cli/opencode-rate-limit.mjs
//
// `opencode/big-pickle` is served anonymously with a small quota. Once it is
// spent, Zen answers "Rate limit exceeded" and opencode retries with backoff
// while emitting no JSON event, so the only thing the app can observe is its
// own 120 s timeout — plus, since 27bd533, the CLI's last ERROR log line.
// This script takes ~2 minutes by design. If Zen happens to answer (quota
// refilled), that is recorded too — the row is then "not reproducible now".
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DIST = path.join(REPO, 'apps/backend/dist');
const require = createRequire(path.join(REPO, 'apps/backend/package.json'));
const { AgentCliLlmClient, AGENT_ADAPTERS } = require(path.join(DIST, 'common/llm/index.js'));
const { z } = require('zod');

const client = new AgentCliLlmClient(
  { provider: 'opencode', model: 'opencode/big-pickle' },
  AGENT_ADAPTERS.opencode,
);
const started = Date.now();
let out;
try {
  const r = await client.parse(z.object({ ok: z.boolean() }), 'tiny', {
    systemPrompt: 'Answer {"ok":true}.',
    userPrompt: 'go',
  });
  out = { outcome: 'answered', model: r.model, wallMs: Date.now() - started };
} catch (err) {
  out = {
    outcome: 'failed',
    wallMs: Date.now() - started,
    errorCode: err.code ?? err.constructor?.name,
    message: err.message,
  };
}
console.log(JSON.stringify(out, null, 2));
writeFileSync(path.join(HERE, 'rate-limit.json'), `${JSON.stringify(out, null, 2)}\n`);
