// The OpenCode adapter proved at the LLM boundary: commit analysis, brief
// generation, and the two failure paths (unknown model, provider 401).
//
//   node apps/backend/test/agent-cli/opencode.mjs
//
// Same shape as ./claude-code.mjs: the COMPILED backend
// (apps/backend/dist) drives the real `AgentCliLlmClient`, which spawns the
// real `opencode` binary through the real adapter. No mocks, no fixtures.
//
// Model: `openai/gpt-5-nano`, not the default `opencode/big-pickle` — Zen is
// not connected on this machine and signing the user in is out of scope. The
// adapter, env hook and parser are identical for every provider/model.
//
// Row 4b (401) points OPENCODE_CONFIG at a file that overrides the OpenAI key
// with a bad one. That is a lower-precedence tier than the adapter's own
// OPENCODE_CONFIG_CONTENT, so the agent definition still wins, and nothing
// under ~/.local/share/opencode is touched.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DIST = path.join(REPO, 'apps/backend/dist');
const require = createRequire(path.join(REPO, 'apps/backend/package.json'));

const { AgentCliLlmClient, AGENT_ADAPTERS } = require(
  path.join(DIST, 'common/llm/index.js'),
);
const { CommitAnalyzerService } = require(
  path.join(DIST, 'integrations/github/commit-analysis/services/commit-analyzer.service.js'),
);
const { CommitAnalysisOutputSchema } = require(
  path.join(DIST, 'integrations/github/commit-analysis/schemas/analysis-output.schema.js'),
);
const { BriefOutputSchema } = require(
  path.join(DIST, 'briefs/generation/schemas/brief-output.schema.js'),
);
const { BRIEF_SYSTEM_PROMPT, buildBriefUserPrompt } = require(
  path.join(DIST, 'briefs/generation/services/brief-summary-prompt.js'),
);

const ADAPTER = AGENT_ADAPTERS.opencode;
const MODEL = process.env.BOUNDARY_MODEL ?? 'openai/gpt-5-nano';
const SHA = process.env.BOUNDARY_SHA ?? 'b0e8c40';
const MAX_DIFF_CHARS = 20_000;

const git = (...args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function commitFiles(sha) {
  return git('show', sha, '--numstat', '--format=')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, p] = line.split('\t');
      return {
        path: p,
        additions: Number(additions) || 0,
        deletions: Number(deletions) || 0,
        patch: git('diff', `${sha}^`, sha, '--', p).replace(/^diff --git[\s\S]*?@@/m, '@@'),
      };
    });
}

const client = (model = MODEL) =>
  new AgentCliLlmClient({ provider: 'opencode', model }, ADAPTER);

const out = { model: MODEL, sha: SHA, runs: [] };
const record = (r) => {
  out.runs.push(r);
  console.log(`\n### ROW ${r.row} ${r.what} (${r.wallMs} ms)`);
  console.log(JSON.stringify(r, null, 2));
};

// ----------------------------------------------------------------- row 3a ---
{
  const files = commitFiles(SHA);
  const analyzer = new CommitAnalyzerService(client(), {
    maxDiffChars: MAX_DIFF_CHARS,
    teamSize: 4,
    teamConcurrency: 2,
    llm: null,
  });
  const started = Date.now();
  const r = await analyzer.analyzeCommit({
    repoFullName: 'VirtualPirate/devsummary-desktop',
    authorName: git('show', SHA, '-s', '--format=%an').trim(),
    authorEmail: git('show', SHA, '-s', '--format=%ae').trim(),
    message: git('show', SHA, '-s', '--format=%B').trim(),
    files,
  });
  record({
    row: '3a',
    what: 'commit analysis',
    filesIn: files.length,
    diffCharsSent: r.diffCharsSent,
    status: r.status,
    commit_type: r.commitType,
    summary: r.summary,
    changes: r.changes,
    model: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    wallMs: Date.now() - started,
    revalidated: CommitAnalysisOutputSchema.safeParse(r.rawOutput).success,
  });
}

// ----------------------------------------------------------------- row 3b ---
{
  const commits = [
    {
      sha: 'aa9188b',
      authorName: 'VirtualPirate',
      authorEmail: 'dev@example.com',
      messageFirstLine: 'feat(llm): let an agent CLI adapter contribute child env',
      analysis: {
        commitType: 'feature',
        summary: 'An adapter can now hand extra environment variables to the CLI it drives',
        changes: ['Merged over the parent environment at spawn time'],
      },
    },
    {
      sha: 'b0e8c40',
      authorName: 'VirtualPirate',
      authorEmail: 'dev@example.com',
      messageFirstLine: 'feat(llm): add the OpenCode adapter and register it as a provider',
      analysis: {
        commitType: 'feature',
        summary: 'OpenCode became a selectable AI provider',
        changes: [
          'Defines a tool-less agent inline through the environment',
          'Reads the JSON event stream and ignores the exit code',
        ],
      },
    },
  ];
  const userPrompt = buildBriefUserPrompt({
    scopeLabel: 'DevSummary desktop · OpenCode adapter',
    period: {
      start: new Date('2026-09-09T00:00:00+05:30'),
      end: new Date('2026-09-10T00:00:00+05:30'),
    },
    timezone: 'Asia/Kolkata',
    commits,
    maxChars: 30_000,
  });
  const started = Date.now();
  const r = await client().parse(BriefOutputSchema, 'brief_output', {
    systemPrompt: BRIEF_SYSTEM_PROMPT,
    userPrompt,
  });
  record({
    row: '3b',
    what: 'brief generation',
    userPromptChars: userPrompt.length,
    title: r.parsed.title,
    summary: r.parsed.summary,
    highlights: r.parsed.highlights,
    model: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    wallMs: Date.now() - started,
  });
}

// ------------------------------------------------------------------ row 4 ---
const TINY = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const { z } = require('zod');
const TinySchema = z.object({ ok: z.boolean() });

async function expectFailure(row, what, model, env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const started = Date.now();
  try {
    await client(model).parse(TinySchema, 'tiny', {
      systemPrompt: 'Answer {"ok":true}.',
      userPrompt: 'go',
    });
    record({ row, what, wallMs: Date.now() - started, error: 'NONE — call unexpectedly succeeded' });
  } catch (err) {
    record({
      row,
      what,
      wallMs: Date.now() - started,
      errorCode: err.code ?? err.constructor?.name,
      message: err.message,
    });
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

await expectFailure('4a', 'unknown model', 'openai/no-such-model', {});

const cfgDir = mkdtempSync(path.join(os.tmpdir(), 'opencode-badkey-'));
const cfgFile = path.join(cfgDir, 'opencode.json');
writeFileSync(
  cfgFile,
  JSON.stringify({ provider: { openai: { options: { apiKey: 'sk-bad-key-000' } } } }),
);
await expectFailure('4b', 'provider 401', MODEL, { OPENCODE_CONFIG: cfgFile });

writeFileSync(path.join(HERE, `${path.basename(fileURLToPath(import.meta.url), '.mjs')}.json`), `${JSON.stringify(out, null, 2)}\n`);

for (const r of out.runs) {
  if (String(r.row).startsWith('3') && (!r.promptTokens || !r.completionTokens)) {
    throw new Error(`row ${r.row}: missing token counts — ${JSON.stringify(r)}`);
  }
  if (String(r.row).startsWith('4') && !r.errorCode) {
    throw new Error(`row ${r.row}: expected a failure — ${JSON.stringify(r)}`);
  }
}
console.log('\nrows 3a/3b parsed with non-zero token counts; rows 4a/4b failed as expected');
