import { AGENT_ADAPTERS, claudeCodeAdapter, isAgentProvider } from '..';

/** Verbatim shape of a real `claude -p --output-format json` answer. */
const SUCCESS = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"commit_type":"chore"}',
  structured_output: { commit_type: 'chore' },
  num_turns: 1,
  duration_ms: 4213,
  usage: {
    input_tokens: 4,
    cache_creation_input_tokens: 1200,
    cache_read_input_tokens: 300,
    output_tokens: 18,
  },
  modelUsage: {
    'claude-haiku-4-5-20251001': {
      inputTokens: 4,
      outputTokens: 18,
      costUSD: 0.0012,
    },
  },
  total_cost_usd: 0.0012,
});

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });

describe('claudeCodeAdapter.buildArgs', () => {
  it('carries the schema, model and system prompt on argv', () => {
    expect(
      claudeCodeAdapter.buildArgs({
        model: 'haiku',
        systemPrompt: 'You classify commits.',
        jsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
        },
        schemaName: 'commit_analysis',
      }),
    ).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}',
      '--tools',
      '',
      '--model',
      'haiku',
      '--system-prompt',
      'You classify commits.',
      '--no-session-persistence',
    ]);
  });

  // Both flags look like the obvious way to lock the CLI down and neither is:
  // `--bare` drops the claude.ai login, and `--disallowedTools "*"` blocks the
  // internal StructuredOutput tool so the model answers in prose.
  it('never passes --bare or --disallowedTools', () => {
    const argv = claudeCodeAdapter.buildArgs({
      model: 'haiku',
      systemPrompt: 's',
      jsonSchema: {},
      schemaName: 'n',
    });
    expect(argv).not.toContain('--bare');
    expect(argv).not.toContain('--disallowedTools');
  });

  it('never puts a prompt body on argv beyond the system prompt', () => {
    const argv = claudeCodeAdapter.buildArgs({
      model: 'haiku',
      systemPrompt: 'sys',
      jsonSchema: {},
      schemaName: 'n',
    });
    expect(argv).not.toContain('--prompt');
  });
});

describe('claudeCodeAdapter.parseOutput', () => {
  it('returns structured_output with cache reads counted as input tokens', () => {
    expect(claudeCodeAdapter.parseOutput(ok(SUCCESS))).toEqual({
      ok: true,
      raw: { commit_type: 'chore' },
      model: 'claude-haiku-4-5-20251001',
      // 4 + 1200 + 300: a cache write and a cache read are input tokens too,
      // and the caller stores one number.
      promptTokens: 1504,
      completionTokens: 18,
    });
  });

  it('reports null for the model when modelUsage names more than one', () => {
    const body = JSON.stringify({
      is_error: false,
      structured_output: { commit_type: 'chore' },
      usage: { input_tokens: 1, output_tokens: 2 },
      modelUsage: { 'model-a': {}, 'model-b': {} },
    });
    expect(claudeCodeAdapter.parseOutput(ok(body))).toMatchObject({
      ok: true,
      model: null,
    });
  });

  it('reports null tokens when the envelope carries no usage', () => {
    const body = JSON.stringify({
      is_error: false,
      structured_output: { commit_type: 'chore' },
    });
    expect(claudeCodeAdapter.parseOutput(ok(body))).toMatchObject({
      ok: true,
      promptTokens: null,
      completionTokens: null,
    });
  });

  // This is where a logged-out CLI lands, and the exit code is **1**, not 0
  // (verified against claude 2.1.265 — see
  // docs/receipts/AGENT-CLI-CLAUDE-CODE.md). The envelope is still on stdout
  // and still carries the one sentence a user can act on, so it has to beat
  // the exit code; reading the code first put the whole ~1.5 KB blob in the
  // reason. Transport, not a bad body, so the retry path stays correct.
  it('prefers the envelope’s own reason over a non-zero exit', () => {
    const body = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      terminal_reason: 'api_error',
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
    });
    expect(
      claudeCodeAdapter.parseOutput({ code: 1, stdout: body, stderr: '' }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'Not logged in · Please run /login',
    });
  });

  it('maps is_error to transport with the CLI’s own reason on a clean exit', () => {
    const body = JSON.stringify({
      is_error: true,
      result: 'Credit balance too low',
      terminal_reason: 'api_error',
    });
    expect(claudeCodeAdapter.parseOutput(ok(body))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'Credit balance too low',
    });
  });

  // A good answer is a good answer: the exit code does not get to veto an
  // envelope that parsed and carried `structured_output`.
  it('accepts a complete envelope even on a non-zero exit', () => {
    expect(
      claudeCodeAdapter.parseOutput({ code: 1, stdout: SUCCESS, stderr: '' }),
    ).toMatchObject({
      ok: true,
      raw: { commit_type: 'chore' },
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('maps a missing structured_output to invalid, not transport', () => {
    const body = JSON.stringify({ is_error: false, result: 'sure thing' });
    expect(claudeCodeAdapter.parseOutput(ok(body))).toEqual({
      ok: false,
      kind: 'invalid',
      reason: 'response had no structured_output',
    });
  });

  it('maps a non-zero exit to transport with the first stderr line', () => {
    expect(
      claudeCodeAdapter.parseOutput({
        code: 1,
        stdout: '',
        stderr: 'error: unknown option --nope\nUsage: claude [options]\n',
      }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'error: unknown option --nope',
    });
  });

  it('maps unparseable stdout to transport', () => {
    expect(
      claudeCodeAdapter.parseOutput({
        code: 0,
        stdout: 'Welcome to Claude Code\n',
        stderr: '',
      }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'Welcome to Claude Code',
    });
  });

  // Parsed, but none of the envelope's markers: the process ran fine and the
  // body is unusable, so it must not go back on the transport retry path.
  it('maps JSON that is not the envelope to invalid on a clean exit', () => {
    expect(
      claudeCodeAdapter.parseOutput({
        code: 0,
        stdout: '{"hello":"world"}',
        stderr: '',
      }),
    ).toEqual({
      ok: false,
      kind: 'invalid',
      reason: '{"hello":"world"}',
    });
  });

  it('still reports something when a non-zero exit printed nothing', () => {
    expect(
      claudeCodeAdapter.parseOutput({ code: 137, stdout: '', stderr: '' }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'claude exited with code 137',
    });
  });
});

describe('claudeCodeAdapter.parseAuth', () => {
  it('reads loggedIn out of `claude auth status`', () => {
    expect(
      claudeCodeAdapter.parseAuth?.(
        '{"loggedIn":true,"authMethod":"claude.ai"}',
      ),
    ).toBe(true);
    expect(claudeCodeAdapter.parseAuth?.('{"loggedIn":false}')).toBe(false);
  });

  it('is false on anything it cannot read rather than throwing', () => {
    expect(claudeCodeAdapter.parseAuth?.('command not found')).toBe(false);
    expect(claudeCodeAdapter.parseAuth?.('')).toBe(false);
  });
});

describe('AGENT_ADAPTERS', () => {
  it('registers Claude Code under its provider id', () => {
    expect(AGENT_ADAPTERS['claude-code']).toBe(claudeCodeAdapter);
    expect(claudeCodeAdapter.id).toBe('claude-code');
    expect(claudeCodeAdapter.binary).toBe('claude');
    expect(claudeCodeAdapter.versionArgs).toEqual(['--version']);
    expect(claudeCodeAdapter.authArgs).toEqual(['auth', 'status']);
  });

  it('recognises only registered ids as agent providers', () => {
    expect(isAgentProvider('claude-code')).toBe(true);
    expect(isAgentProvider('openai')).toBe(false);
    expect(isAgentProvider('codex')).toBe(false);
    // An inherited key is not a registered provider.
    expect(isAgentProvider('toString')).toBe(false);
  });
});
