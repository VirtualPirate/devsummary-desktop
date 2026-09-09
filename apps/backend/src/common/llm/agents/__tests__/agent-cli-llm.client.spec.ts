import { z } from 'zod';
import {
  AgentCliLlmClient,
  claudeCodeAdapter,
  type AgentCliAdapter,
  type AgentCliDetector,
  type CliOptions,
  type CliResult,
  type RunCli,
} from '..';
import type { LlmSettings } from '../../llm-config';

const SETTINGS: LlmSettings = { provider: 'claude-code', model: 'haiku' };
const SCHEMA = z.object({ ok: z.boolean() });
const PROMPTS = { systemPrompt: 'sys', userPrompt: 'the whole diff' };

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    is_error: false,
    structured_output: { ok: true },
    usage: {
      input_tokens: 5,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 20,
      output_tokens: 7,
    },
    modelUsage: { 'claude-haiku-4-5-20251001': {} },
    ...over,
  });

const detectorFor = (path: string | null): AgentCliDetector =>
  ({ binaryPath: () => Promise.resolve(path) }) as unknown as AgentCliDetector;

/** Records every spawn and answers each with the same fixture. */
function fixedRun(result: CliResult | Promise<CliResult>) {
  const calls: Array<{ file: string; args: string[]; opts: CliOptions }> = [];
  const run: RunCli = (file, args, opts) => {
    calls.push({ file, args, opts });
    return Promise.resolve(result);
  };
  return { run, calls };
}

const client = (run: RunCli, path: string | null = '/usr/bin/claude') =>
  new AgentCliLlmClient(SETTINGS, claudeCodeAdapter, detectorFor(path), run);

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('AgentCliLlmClient success path', () => {
  it('spawns the detected binary, sends the user prompt on stdin, and sums tokens', async () => {
    const { run, calls } = fixedRun({
      code: 0,
      stdout: envelope(),
      stderr: '',
      timedOut: false,
    });

    expect(await client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS)).toEqual({
      parsed: { ok: true },
      model: 'claude-haiku-4-5-20251001',
      promptTokens: 125,
      completionTokens: 7,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('/usr/bin/claude');
    // The prompt is on stdin and nowhere else.
    expect(calls[0].opts.stdin).toBe('the whole diff');
    expect(calls[0].args).not.toContain('the whole diff');
    expect(calls[0].opts.timeoutMs).toBe(120_000);
  });

  it('passes the caller’s Zod schema through as draft-7 JSON Schema', async () => {
    const { run, calls } = fixedRun({
      code: 0,
      stdout: envelope(),
      stderr: '',
      timedOut: false,
    });

    await client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS);

    const schemaArg = calls[0].args[calls[0].args.indexOf('--json-schema') + 1];
    expect(JSON.parse(schemaArg)).toMatchObject({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    });
    expect(calls[0].args[calls[0].args.indexOf('--model') + 1]).toBe('haiku');
  });

  // A CLI that takes its system prompt or its tool policy through the
  // environment instead of argv (OpenCode) gets it from the same request the
  // argv was built from — so the two can never describe different calls.
  it('passes the adapter’s env to the runner, and none when it defines none', async () => {
    const withEnv: AgentCliAdapter = {
      ...claudeCodeAdapter,
      env: (req) => ({ AGENT_SYSTEM_PROMPT: req.systemPrompt }),
    };
    const finished = {
      code: 0,
      stdout: envelope(),
      stderr: '',
      timedOut: false,
    };

    const withHook = fixedRun(finished);
    await new AgentCliLlmClient(
      SETTINGS,
      withEnv,
      detectorFor('/usr/bin/claude'),
      withHook.run,
    ).parse(SCHEMA, 'agent_cli_test', PROMPTS);
    expect(withHook.calls[0].opts.env).toEqual({ AGENT_SYSTEM_PROMPT: 'sys' });

    const without = fixedRun(finished);
    await client(without.run).parse(SCHEMA, 'agent_cli_test', PROMPTS);
    expect(without.calls[0].opts.env).toBeUndefined();
  });

  it('falls back to the configured model when the CLI names none', async () => {
    const { run } = fixedRun({
      code: 0,
      stdout: envelope({ modelUsage: undefined }),
      stderr: '',
      timedOut: false,
    });

    expect(
      await client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).toMatchObject({ model: 'haiku' });
  });
});

// A CLI call is a whole process, not a socket. Commit analysis fans out five at
// a time and five `claude` processes on a laptop is not a good trade.
describe('AgentCliLlmClient concurrency', () => {
  it('runs at most two processes at once and admits the rest as they finish', async () => {
    const resolvers: Array<(r: CliResult) => void> = [];
    const run: RunCli = () =>
      new Promise<CliResult>((resolve) => {
        resolvers.push(resolve);
      });
    const subject = client(run);

    const calls = [1, 2, 3, 4, 5].map(() =>
      subject.parse(SCHEMA, 'agent_cli_test', PROMPTS),
    );
    await flush();
    expect(resolvers).toHaveLength(2);

    const finish = { code: 0, stdout: envelope(), stderr: '', timedOut: false };
    resolvers[0](finish);
    resolvers[1](finish);
    await flush();
    expect(resolvers).toHaveLength(4);

    resolvers[2](finish);
    resolvers[3](finish);
    await flush();
    expect(resolvers).toHaveLength(5);

    resolvers[4](finish);
    await expect(Promise.all(calls)).resolves.toHaveLength(5);
  });

  // Four calls against two slots, the first three failing: the fourth can only
  // ever spawn if a failed call hands its slot back. Two sequential calls would
  // pass with the release deleted — there is a free slot for the second either
  // way — so the count is the assertion that matters here.
  it('releases its slot when a call fails', async () => {
    const results: CliResult[] = [
      { code: 1, stdout: '', stderr: 'boom\n', timedOut: false },
      { code: 1, stdout: '', stderr: 'boom\n', timedOut: false },
      { code: 1, stdout: '', stderr: 'boom\n', timedOut: false },
      { code: 0, stdout: envelope(), stderr: '', timedOut: false },
    ];
    const spawns: string[] = [];
    const run: RunCli = (file) => {
      spawns.push(file);
      return Promise.resolve(results.shift()!);
    };
    const subject = client(run);

    // Settled eagerly, in this tick: an unhandled rejection here would fail the
    // suite from somewhere else entirely.
    const outcomes = [1, 2, 3, 4].map(() =>
      subject.parse(SCHEMA, 'agent_cli_test', PROMPTS).then(
        () => 'resolved',
        (err: { code: string }) => err.code,
      ),
    );

    await flush();
    expect(spawns).toHaveLength(4);
    await expect(Promise.all(outcomes)).resolves.toEqual([
      'OPENAI_API_FAILED',
      'OPENAI_API_FAILED',
      'OPENAI_API_FAILED',
      'resolved',
    ]);
  });
});

describe('AgentCliLlmClient error mapping', () => {
  it('raises OPENAI_NOT_CONFIGURED naming the CLI when it is not installed', async () => {
    const { run, calls } = fixedRun({
      code: 0,
      stdout: envelope(),
      stderr: '',
      timedOut: false,
    });

    await expect(
      client(run, null).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      code: 'OPENAI_NOT_CONFIGURED',
      message: expect.stringContaining('Claude Code is not installed'),
    });
    expect(calls).toHaveLength(0);
  });

  it('raises OPENAI_API_FAILED with the CLI’s reason when it is logged out', async () => {
    const { run } = fixedRun({
      code: 0,
      stdout: JSON.stringify({
        is_error: true,
        result: 'Not logged in · Please run /login',
      }),
      stderr: '',
      timedOut: false,
    });

    await expect(
      client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      code: 'OPENAI_API_FAILED',
      details: { reason: 'Not logged in · Please run /login' },
    });
  });

  it('raises OPENAI_API_FAILED with the first stderr line on a non-zero exit', async () => {
    const { run } = fixedRun({
      code: 1,
      stdout: '',
      stderr: 'error: unknown option\nUsage: claude\n',
      timedOut: false,
    });

    await expect(
      client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      code: 'OPENAI_API_FAILED',
      details: { reason: 'error: unknown option' },
    });
  });

  it('reports a timeout as OPENAI_API_FAILED rather than an empty body', async () => {
    const { run } = fixedRun({
      code: null,
      stdout: '',
      stderr: 'noise the adapter has no hook for\n',
      timedOut: true,
    });

    // The claude adapter defines no `stderrHint`, so its message is bare.
    await expect(
      client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      code: 'OPENAI_API_FAILED',
      details: { reason: 'timed out after 120s' },
    });
  });

  // A CLI that retries a throttled provider internally prints nothing on
  // stdout and gets killed here, so "timed out" would be the whole story. Its
  // own log line is the only place the real cause exists.
  it('appends the adapter’s stderr hint to a timeout when it has one', async () => {
    const withHint: AgentCliAdapter = {
      ...claudeCodeAdapter,
      stderrHint: (stderr) => (stderr.includes('429') ? 'Rate limited' : null),
    };
    const timedOut = {
      code: null,
      stdout: '',
      stderr: 'upstream said 429\n',
      timedOut: true,
    };

    const hinted = fixedRun(timedOut);
    await expect(
      new AgentCliLlmClient(
        SETTINGS,
        withHint,
        detectorFor('/usr/bin/claude'),
        hinted.run,
      ).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      details: { reason: 'timed out after 120s; last CLI error: Rate limited' },
    });

    // Nothing to add: the hook answered null, so the message stays bare.
    const silent = fixedRun({ ...timedOut, stderr: 'nothing useful\n' });
    await expect(
      new AgentCliLlmClient(
        SETTINGS,
        withHint,
        detectorFor('/usr/bin/claude'),
        silent.run,
      ).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      details: { reason: 'timed out after 120s' },
    });
  });

  it('raises OPENAI_API_FAILED when the spawn itself fails', async () => {
    const run: RunCli = () =>
      Promise.reject(
        Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
      );

    await expect(
      client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      code: 'OPENAI_API_FAILED',
      details: { reason: 'spawn ENOENT' },
    });
  });

  // Neither of these is a transport blip, so neither goes back on the retry
  // path meant for network faults.
  it('raises OPENAI_RESPONSE_INVALID when structured_output is missing', async () => {
    const { run } = fixedRun({
      code: 0,
      stdout: JSON.stringify({ is_error: false, result: 'sure' }),
      stderr: '',
      timedOut: false,
    });

    await expect(
      client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({
      code: 'OPENAI_RESPONSE_INVALID',
      details: { reason: 'response had no structured_output' },
    });
  });

  it('raises OPENAI_RESPONSE_INVALID when the body fails the Zod schema', async () => {
    const { run } = fixedRun({
      code: 0,
      stdout: envelope({ structured_output: { ok: 'yes' } }),
      stderr: '',
      timedOut: false,
    });

    await expect(
      client(run).parse(SCHEMA, 'agent_cli_test', PROMPTS),
    ).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });
});
