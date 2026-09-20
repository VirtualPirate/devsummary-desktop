import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_ADAPTERS, cursorAdapter, isAgentProvider } from '..';

// Same expression the adapter resolves at import time: the Electron
// `userData` folder when there is one, the per-user temp dir headless.
const WORKSPACE = join(process.env.DATA_DIR ?? tmpdir(), 'cursor-workspace');

const REQUEST = {
  model: 'composer-2.5-fast',
  systemPrompt: 'You classify commits.',
  jsonSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
  schemaName: 'commit_analysis',
};

const SUCCESS = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"ok":true}',
  usage: {
    inputTokens: 13118,
    outputTokens: 99,
    cacheReadTokens: 5760,
    cacheWriteTokens: 0,
  },
});

const output = (
  stdout: string,
  over: { code?: number | null; stderr?: string } = {},
) => ({
  code: over.code ?? 0,
  stdout,
  stderr: over.stderr ?? '',
});

describe('cursorAdapter.buildArgs', () => {
  it('runs Cursor in headless, read-only ask mode inside the scratch workspace', () => {
    expect(cursorAdapter.buildArgs(REQUEST)).toEqual([
      '-p',
      '--output-format',
      'json',
      '--mode',
      'ask',
      '--trust',
      '--workspace',
      WORKSPACE,
      '--model',
      'composer-2.5-fast',
    ]);
  });

  it('never enables write, shell, or MCP approval escape hatches', () => {
    const argv = cursorAdapter.buildArgs(REQUEST);
    expect(argv).not.toContain('--force');
    expect(argv).not.toContain('--yolo');
    expect(argv).not.toContain('--bare');
    expect(argv).not.toContain('--auto-review');
    expect(argv).not.toContain('--approve-mcps');
  });
});

describe('cursorAdapter.stdin', () => {
  it('prepends the system prompt and schema contract before the user prompt', () => {
    const stdin = cursorAdapter.stdin?.(REQUEST, 'the whole diff') ?? '';

    expect(stdin.startsWith(REQUEST.systemPrompt)).toBe(true);
    expect(stdin).toContain(REQUEST.schemaName);
    expect(stdin).toContain(JSON.stringify(REQUEST.jsonSchema));
    expect(stdin).toContain('no markdown fences');
    expect(stdin.endsWith('the whole diff')).toBe(true);
  });
});

describe('cursorAdapter.parseOutput', () => {
  it('reads the JSON string result and sums every input-token field', () => {
    expect(cursorAdapter.parseOutput(output(SUCCESS))).toEqual({
      ok: true,
      raw: { ok: true },
      model: null,
      promptTokens: 18878,
      completionTokens: 99,
    });
  });

  it('unwraps a ```json fence around the result', () => {
    const stdout = JSON.stringify({
      type: 'result',
      is_error: false,
      result: '```json\n{"ok":true}\n```',
    });
    expect(cursorAdapter.parseOutput(output(stdout))).toMatchObject({
      ok: true,
      raw: { ok: true },
    });
  });

  it('digs the JSON out of a narrated result', () => {
    // Measured live on composer-2.5: told "nothing before or after it", it
    // still prefixes a line about what it is doing.
    const stdout = JSON.stringify({
      type: 'result',
      is_error: false,
      result:
        'Exploring the workspace {the tool} first.\n{"text":"done","toolCalls":[]}',
    });
    expect(cursorAdapter.parseOutput(output(stdout))).toMatchObject({
      ok: true,
      raw: { text: 'done', toolCalls: [] },
    });
  });

  it('maps an envelope is_error to transport using its result', () => {
    const stdout = JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Authentication required',
    });
    expect(cursorAdapter.parseOutput(output(stdout, { code: 1 }))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'Authentication required',
    });
  });

  it('uses a generic transport reason when an error envelope has no result', () => {
    expect(
      cursorAdapter.parseOutput(
        output(JSON.stringify({ type: 'result', is_error: true })),
      ),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'agent reported an error',
    });
  });

  it('maps malformed result JSON to invalid', () => {
    const stdout = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'not json',
    });
    expect(cursorAdapter.parseOutput(output(stdout))).toEqual({
      ok: false,
      kind: 'invalid',
      reason: 'answer was not JSON',
    });
  });

  it('maps a non-zero exit without an envelope to transport', () => {
    expect(
      cursorAdapter.parseOutput(
        output('', {
          code: 2,
          stderr: 'error: unknown model\nUsage: agent\n',
        }),
      ),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'error: unknown model',
    });
  });

  it('strips the colour codes the CLI wraps its errors in', () => {
    // Verified live: a bad CURSOR_API_KEY answers exactly this, escapes and
    // all, and the reason is stored and shown to a user.
    expect(
      cursorAdapter.parseOutput(
        output('', {
          code: 1,
          stderr:
            '\u001b[33m⚠ Warning: The provided API key is invalid.\u001b[0m',
        }),
      ),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: '⚠ Warning: The provided API key is invalid.',
    });
  });

  it('maps clean JSON without an envelope to invalid', () => {
    expect(cursorAdapter.parseOutput(output('{"hello":"world"}'))).toEqual({
      ok: false,
      kind: 'invalid',
      reason: '{"hello":"world"}',
    });
  });

  it('maps clean non-JSON output without an envelope to transport', () => {
    expect(
      cursorAdapter.parseOutput(output('Cursor Agent needs you to log in\n')),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'Cursor Agent needs you to log in',
    });
  });
});

describe('cursorAdapter auth and registration', () => {
  it('reads isAuthenticated from agent status JSON', () => {
    expect(
      cursorAdapter.parseAuth?.('{"isAuthenticated":true,"email":"a@b.test"}'),
    ).toBe(true);
    expect(cursorAdapter.parseAuth?.('{"isAuthenticated":false}')).toBe(false);
    expect(cursorAdapter.parseAuth?.('not json')).toBe(false);
  });

  it('keeps its scratch workspace out of the shared temp dir when DATA_DIR is set', () => {
    // The reason the path is not a fixed `/tmp` name: on Linux that is world
    // writable, and a pre-created symlink there would become the workspace.
    expect(cursorAdapter.workspaceDir).toBe(WORKSPACE);
    expect(cursorAdapter.workspaceDir).not.toBe(tmpdir());
  });

  it('registers Cursor under its provider id', () => {
    expect(AGENT_ADAPTERS.cursor).toBe(cursorAdapter);
    expect(cursorAdapter.id).toBe('cursor');
    expect(cursorAdapter.binary).toBe('agent');
    expect(cursorAdapter.versionArgs).toEqual(['--version']);
    expect(cursorAdapter.authArgs).toEqual(['status', '--format', 'json']);
    expect(cursorAdapter.workspaceDir).toBe(WORKSPACE);
    expect(isAgentProvider('cursor')).toBe(true);
  });
});
