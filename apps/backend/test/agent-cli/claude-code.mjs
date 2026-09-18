// The Claude Code adapter proved at the LLM boundary — commit analysis and
// brief generation — instead of through a GitHub ingest.
//
//   node apps/backend/test/agent-cli/claude-code.mjs
//
// Why not the real ingest: a scratch userData has no GitHub PAT and no tracked
// repository, and spending the user's GitHub credentials plus a full sync's
// worth of API quota is out of scope for this receipt. What the ingest adds
// over this script is the DB write and the usage rollup, both of which are
// provider-agnostic — the commit-analysis and brief job paths call
// `llm.parse()` and store whatever it returns, and never learn which provider
// answered.
//
// Everything below is the COMPILED backend (apps/backend/dist) — the same files
// the desktop shell forks — driving the real `AgentCliLlmClient`, which spawns
// the real `claude` binary. No mocks, no fixtures, no stub runner.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DIST = path.join(REPO, 'apps/backend/dist');
const require = createRequire(path.join(REPO, 'apps/backend/package.json'));

const { AgentCliLlmClient, AGENT_ADAPTERS, DEFAULT_MODELS } = require(
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

const ADAPTER = AGENT_ADAPTERS['claude-code'];
const SHA = process.env.BOUNDARY_SHA ?? '3de6ea3';
/** The ruling's diff budget. `packDiff` does the truncating, as it does in prod. */
const MAX_DIFF_CHARS = 20_000;

const git = (...args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * A real commit from this repo, in the exact `GithubCommitFile[]` shape the
 * GitHub client hands the analyzer — so `filterFiles` and `packDiff` do the
 * same work they do on a real ingest.
 */
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

const client = (job) =>
  new AgentCliLlmClient(
    { provider: 'claude-code', model: DEFAULT_MODELS['claude-code'][job] },
    ADAPTER,
  );

const out = { sha: SHA, runs: [] };

// ------------------------------------------------------------------ row 5 ---
// The real `CommitAnalyzerService`, so the system prompt, the user-prompt
// builder, the noise filter, the diff packer and `CommitAnalysisOutputSchema`
// are all the production ones — nothing about this call is written here.
{
  const files = commitFiles(SHA);
  const analyzer = new CommitAnalyzerService(client('commitAnalysis'), {
    maxDiffChars: MAX_DIFF_CHARS,
    teamSize: 4,
    teamConcurrency: 2,
    llm: null,
  });
  const message = git('show', SHA, '-s', '--format=%B').trim();
  const started = Date.now();
  const r = await analyzer.analyzeCommit({
    repoFullName: 'VirtualPirate/devsummary-desktop',
    authorName: git('show', SHA, '-s', '--format=%an').trim(),
    authorEmail: git('show', SHA, '-s', '--format=%ae').trim(),
    message,
    files,
  });
  const wallMs = Date.now() - started;
  // Not the client's word for it: re-validate the stored shape against the
  // schema the DB column is written from.
  const revalidated = CommitAnalysisOutputSchema.safeParse(r.rawOutput).success;
  out.runs.push({
    row: 5,
    what: 'commit analysis',
    schema: 'CommitAnalysisOutputSchema',
    filesIn: files.length,
    diffCharsSent: r.diffCharsSent,
    diffWasTruncated: r.diffWasTruncated,
    status: r.status,
    commit_type: r.commitType,
    summary: r.summary,
    changes: r.changes,
    model: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    wallMs,
    revalidated,
  });
  console.log(`\n### ROW 5 commit analysis (${wallMs} ms)`);
  console.log(JSON.stringify(out.runs.at(-1), null, 2));
}

// ------------------------------------------------------------------ row 6 ---
// The real `BRIEF_SYSTEM_PROMPT` and the real `buildBriefUserPrompt`, over the
// commits that built this feature.
{
  const commits = [
    {
      sha: '3de6ea3',
      authorName: 'VirtualPirate',
      authorEmail: 'dev@example.com',
      messageFirstLine: 'feat(llm): normalized agent CLI adapter seam + Claude Code adapter',
      analysis: {
        commitType: 'feature',
        summary: 'Added a normalized adapter seam so a local coding-agent CLI can serve as an AI provider',
        changes: [
          'Introduced an adapter interface that builds argv and reads output without ever spawning a process',
          'Added the Claude Code adapter behind it',
        ],
      },
    },
    {
      sha: '4e5f55d',
      authorName: 'VirtualPirate',
      authorEmail: 'dev@example.com',
      messageFirstLine: 'feat(llm): agent CLI detection through the login shell, with a 60s cache',
      analysis: {
        commitType: 'feature',
        summary: 'The app now finds a CLI the user installed even though its own launch environment cannot see it',
        changes: [
          'Looks the binary up through the user login shell when the process PATH misses it',
          'Runs the binary to confirm it works rather than trusting the lookup',
          'Caches the answer for a minute so a burst of jobs pays for one check',
        ],
      },
    },
    {
      sha: '1ebf14f',
      authorName: 'VirtualPirate',
      authorEmail: 'dev@example.com',
      messageFirstLine: 'feat(llm): run structured calls through an agent CLI; add claude-code provider',
      analysis: {
        commitType: 'feature',
        summary: 'Claude Code became a selectable AI provider that needs no API key',
        changes: [
          'Structured calls now run through the installed CLI, with the prompt on standard input',
          'Limited to two CLI processes at a time with a two-minute ceiling per call',
          'A missing or logged-out CLI fails the job instead of quietly falling back to another provider',
        ],
      },
    },
    {
      sha: 'fd2afda',
      authorName: 'VirtualPirate',
      authorEmail: 'dev@example.com',
      messageFirstLine: 'feat(frontend): Claude Code provider card on the AI integrations page',
      analysis: {
        commitType: 'feature',
        summary: 'The AI settings page now offers Claude Code alongside the two key-based providers',
        changes: [
          'Shows the detected version and the absolute path of the binary it will run',
          'Adds a one-click test that makes a real call, and a re-detect button',
          'Warns when the selected CLI is missing or not logged in, naming the fix',
        ],
      },
    },
  ];
  const period = { start: new Date('2026-09-08T00:00:00+05:30'), end: new Date('2026-09-10T00:00:00+05:30') };
  const userPrompt = buildBriefUserPrompt({
    scopeLabel: 'DevSummary desktop · agent CLI provider',
    period,
    timezone: 'Asia/Kolkata',
    commits,
    maxChars: 30_000,
  });

  const started = Date.now();
  const r = await client('brief').parse(BriefOutputSchema, 'brief_output', {
    systemPrompt: BRIEF_SYSTEM_PROMPT,
    userPrompt,
  });
  const wallMs = Date.now() - started;
  out.runs.push({
    row: 6,
    what: 'brief generation',
    schema: 'BriefOutputSchema',
    commitsIn: commits.length,
    userPromptChars: userPrompt.length,
    title: r.parsed.title,
    summary: r.parsed.summary,
    highlights: r.parsed.highlights,
    model: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    wallMs,
  });
  console.log(`\n### ROW 6 brief generation (${wallMs} ms)`);
  console.log(JSON.stringify(out.runs.at(-1), null, 2));
}

writeFileSync(path.join(HERE, `${path.basename(fileURLToPath(import.meta.url), '.mjs')}.json`), `${JSON.stringify(out, null, 2)}\n`);

// The one check that fails loudly if either call came back empty-handed.
for (const r of out.runs) {
  if (!r.model || !r.promptTokens || !r.completionTokens) {
    throw new Error(`row ${r.row}: missing model or token counts — ${JSON.stringify(r)}`);
  }
}
console.log('\nboth rows returned a parsed body, a resolved model id and non-zero token counts');
