import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_ADAPTERS, codexAdapter, isAgentProvider } from '..';

// The same expressions the adapter resolves at import time: the Electron
// `userData` folder when there is one, the per-user temp dir headless.
const SCRATCH = process.env.DATA_DIR ?? tmpdir();
const WORKSPACE = join(SCRATCH, 'codex-workspace');
const SCHEMA_FILE = join(SCRATCH, 'codex-schemas', 'commit_analysis.json');

const REQUEST = {
  model: 'gpt-5.6-luna',
  systemPrompt: 'You classify commits.\nAnswer "well".',
  jsonSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
  schemaName: 'commit_analysis',
};

/** The verbatim shape of a good run, warning item and all. */
const SUCCESS = [
  JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
  JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_0',
      type: 'error',
      message: 'Skill descriptions were shortened to fit the skills budget.',
    },
  }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: '{"ok":true}' },
  }),
  JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 18879,
      cached_input_tokens: 14115,
      cache_write_input_tokens: 18876,
      output_tokens: 433,
      reasoning_output_tokens: 99,
    },
  }),
].join('\n');

const output = (
  stdout: string,
  over: { code?: number | null; stderr?: string } = {},
) => ({
  code: over.code ?? 0,
  stdout,
  stderr: over.stderr ?? '',
});

describe('codexAdapter.buildArgs', () => {
  it('runs codex non-interactively, read-only, in the scratch workspace', () => {
    expect(codexAdapter.buildArgs(REQUEST)).toEqual([
      'exec',
      '--json',
      '-s',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '-C',
      WORKSPACE,
      '--output-schema',
      SCHEMA_FILE,
      '-m',
      'gpt-5.6-luna',
      '-c',
      `instructions=${JSON.stringify(REQUEST.systemPrompt)}`,
      '-c',
      'shell_environment_policy.inherit="none"',
      '-c',
      'allow_login_shell=false',
      '-',
    ]);
  });

  it('keeps the backend environment out of every command the model runs', () => {
    // Both, because either alone leaks: codex runs commands through a *login*
    // shell by default, and that re-sources the user's profile over whatever
    // the environment policy denied. `SecretsService` puts the decrypted
    // bundle in `process.env`, so this is the OpenAI key and the GitHub PAT.
    const argv = codexAdapter.buildArgs(REQUEST);

    expect(argv).toContain('shell_environment_policy.inherit="none"');
    expect(argv).toContain('allow_login_shell=false');
  });

  it('never hands back write, shell or approval escape hatches', () => {
    const argv = codexAdapter.buildArgs(REQUEST);

    expect(argv).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(argv).not.toContain('--dangerously-bypass-hook-trust');
    expect(argv).not.toContain('--approve-for-me');
    expect(argv).not.toContain('--add-dir');
    expect(argv).not.toContain('workspace-write');
    expect(argv).not.toContain('danger-full-access');
  });

  it('quotes a system prompt that TOML would otherwise reinterpret', () => {
    // The value of a `-c` override is parsed as TOML, so the prompt has to
    // arrive as a basic string — a bare one starting with `[` or `{` would be
    // read as a table and the system prompt would silently change.
    const argv = codexAdapter.buildArgs({
      ...REQUEST,
      systemPrompt: '[not a table]\n"quoted"\\ok',
    });

    expect(argv).toContain('instructions="[not a table]\\n\\"quoted\\"\\\\ok"');
  });
});

describe('codexAdapter.files', () => {
  it('writes the response schema where --output-schema points', () => {
    expect(codexAdapter.files?.(REQUEST)).toEqual({
      [SCHEMA_FILE]: JSON.stringify(REQUEST.jsonSchema),
    });
    expect(codexAdapter.buildArgs(REQUEST)).toContain(SCHEMA_FILE);
  });

  it('keeps a schema name from escaping the schema directory', () => {
    const paths = Object.keys(
      codexAdapter.files?.({ ...REQUEST, schemaName: '../../etc/passwd' }) ??
        {},
    );

    expect(paths).toEqual([
      join(SCRATCH, 'codex-schemas', '.._.._etc_passwd.json'),
    ]);
  });
});

describe('codexAdapter.parseOutput', () => {
  it('reads the agent message and takes input_tokens as the whole prompt', () => {
    // `cached_input_tokens` and `cache_write_input_tokens` are breakdowns of
    // `input_tokens`, and `output_tokens` already includes reasoning — both
    // measured live, so neither is added here.
    expect(codexAdapter.parseOutput(output(SUCCESS))).toEqual({
      ok: true,
      raw: { ok: true },
      model: null,
      promptTokens: 18879,
      completionTokens: 433,
    });
  });

  it('ignores error items on a run that still answered', () => {
    // "Skill descriptions were shortened" and "Model metadata not found" are
    // `error` items on runs that succeed. Treating an error item as a failure
    // would reject every one of them.
    expect(codexAdapter.parseOutput(output(SUCCESS))).toMatchObject({
      ok: true,
    });
  });

  it('takes the last agent message when a turn produced several', () => {
    const stdout = [
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"ok":false}' },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"ok":true}' },
      }),
    ].join('\n');

    expect(codexAdapter.parseOutput(output(stdout))).toMatchObject({
      raw: { ok: true },
    });
  });

  it('unwraps a ```json fence around the answer', () => {
    const stdout = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '```json\n{"ok":true}\n```' },
    });

    expect(codexAdapter.parseOutput(output(stdout))).toMatchObject({
      ok: true,
      raw: { ok: true },
    });
  });

  it('answers null tokens when the turn reported no usage', () => {
    const stdout = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '{"ok":true}' },
    });

    expect(codexAdapter.parseOutput(output(stdout))).toMatchObject({
      promptTokens: null,
      completionTokens: null,
    });
  });

  it('maps an answer that is not JSON to invalid', () => {
    const stdout = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'I had a look and, honestly, no.' },
    });

    expect(codexAdapter.parseOutput(output(stdout, { code: 0 }))).toEqual({
      ok: false,
      kind: 'invalid',
      reason: 'answer was not JSON',
    });
  });

  it('reports turn.failed as transport, in the CLI words', () => {
    // Verbatim from an unknown model, trimmed: exit 1, four retry `error`
    // events, then this.
    const stdout = [
      JSON.stringify({ type: 'error', message: 'Reconnecting... 5/5 (404)' }),
      JSON.stringify({
        type: 'turn.failed',
        error: {
          message:
            'unexpected status 404 Not Found: The model `nope` does not exist or you do not have access to it.',
        },
      }),
    ].join('\n');

    expect(codexAdapter.parseOutput(output(stdout, { code: 1 }))).toEqual({
      ok: false,
      kind: 'transport',
      reason:
        'unexpected status 404 Not Found: The model `nope` does not exist or you do not have access to it.',
    });
  });

  it('falls back to the last retry notice when the stream was cut short', () => {
    const stdout = [
      JSON.stringify({ type: 'error', message: 'Reconnecting... 4/5 (429)' }),
      JSON.stringify({ type: 'error', message: 'Reconnecting... 5/5 (429)' }),
    ].join('\n');

    expect(codexAdapter.parseOutput(output(stdout, { code: null }))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'Reconnecting... 5/5 (429)',
    });
  });

  it('falls back to stderr when nothing reached stdout', () => {
    expect(
      codexAdapter.parseOutput(
        output('', {
          code: 1,
          stderr:
            'Not inside a trusted directory and --skip-git-repo-check was not specified.\n',
        }),
      ),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason:
        'Not inside a trusted directory and --skip-git-repo-check was not specified.',
    });
  });

  it('names the exit code when there is nothing else to say', () => {
    expect(codexAdapter.parseOutput(output('', { code: 2 }))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'codex exited with code 2',
    });
    expect(codexAdapter.parseOutput(output(''))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'codex produced no answer',
    });
  });
});

describe('codexAdapter auth and registration', () => {
  it('reads the plain-text login line', () => {
    expect(
      codexAdapter.parseAuth?.('Logged in using an API key - sk-proj-***abcd'),
    ).toBe(true);
    expect(codexAdapter.parseAuth?.('Not logged in')).toBe(false);
    expect(codexAdapter.parseAuth?.('')).toBe(false);
  });

  it('keeps its scratch workspace out of the shared temp dir', () => {
    // The reason the path is not a fixed `/tmp` name: on Linux that is world
    // writable, and a pre-created symlink there would become the workspace.
    expect(codexAdapter.workspaceDir).toBe(WORKSPACE);
    expect(codexAdapter.workspaceDir).not.toBe(tmpdir());
  });

  it('registers Codex under its provider id', () => {
    expect(AGENT_ADAPTERS.codex).toBe(codexAdapter);
    expect(codexAdapter.id).toBe('codex');
    expect(codexAdapter.binary).toBe('codex');
    expect(codexAdapter.versionArgs).toEqual(['--version']);
    expect(codexAdapter.authArgs).toEqual(['login', 'status']);
    expect(isAgentProvider('codex')).toBe(true);
  });
});
