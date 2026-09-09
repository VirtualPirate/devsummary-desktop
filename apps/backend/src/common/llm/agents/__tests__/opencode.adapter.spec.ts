import { AGENT_ADAPTERS, isAgentProvider, opencodeAdapter } from '..';

/**
 * Verbatim stdout of one real `opencode run --format json` call (1.1.53): JSON
 * lines, one event per line, no envelope and no resolved model id anywhere.
 */
const STEP_START =
  '{"type":"step_start","timestamp":1788918326900,"sessionID":"ses_f7c28a9d2ffeZ5dnU9Xt77hRdJ","part":{"id":"prt_083d76672001x3ZgCZ759MoTSZ","sessionID":"ses_f7c28a9d2ffeZ5dnU9Xt77hRdJ","messageID":"msg_083d759d9001mY2uIRjKK48p0K","type":"step-start"}}';
const TEXT =
  '{"type":"text","timestamp":1788918327599,"sessionID":"ses_f7c28a9d2ffeZ5dnU9Xt77hRdJ","part":{"id":"prt_083d768b2001PVUwJY4GuSA7v0","sessionID":"ses_f7c28a9d2ffeZ5dnU9Xt77hRdJ","messageID":"msg_083d759d9001mY2uIRjKK48p0K","type":"text","text":"{\\"ok\\":true}","time":{"start":1788918327599,"end":1788918327599},"metadata":{"openai":{"itemId":"msg_04f76cd37233bb16016aa0ba3750c487d2bcce10e0b73b14c6"}}}}';
const STEP_FINISH =
  '{"type":"step_finish","timestamp":1788918327666,"sessionID":"ses_f7c28a9d2ffeZ5dnU9Xt77hRdJ","part":{"id":"prt_083d76971001yGnSw3oPlFT7xB","sessionID":"ses_f7c28a9d2ffeZ5dnU9Xt77hRdJ","messageID":"msg_083d759d9001mY2uIRjKK48p0K","type":"step-finish","reason":"stop","cost":0.0013608,"tokens":{"input":24704,"output":186,"reasoning":128,"cache":{"read":0,"write":0}}}}';

const SUCCESS = [STEP_START, TEXT, STEP_FINISH, ''].join('\n');

/** A bad API key. Note the exit code: **0**, with stderr empty. */
const ERROR_EVENT =
  '{"type":"error","timestamp":1788918444199,"sessionID":"ses_f7c26d8caffefb6MWRqLD832pp","error":{"name":"APIError","data":{"message":"Incorrect API key provided: sk-bad-k**-000. You can find your API key at https://platform.openai.com/account/api-keys.","statusCode":401,"isRetryable":false,"responseHeaders":{}}}}';

const API_KEY_MESSAGE =
  'Incorrect API key provided: sk-bad-k**-000. You can find your API key at https://platform.openai.com/account/api-keys.';

/**
 * An unknown model or a provider that is not signed in: stdout is **empty**,
 * the exit code is still **0**, and the only evidence is an ANSI-coloured Bun
 * stack trace on stderr. The escape codes are in the fixture because stripping
 * them is what makes the reason readable.
 */
const NOT_FOUND_STDERR = [
  // `\u001b` rather than a raw escape byte, so the colouring is visible in
  // a diff. It is the same string opencode writes.
  '\u001b[31mProviderModelNotFoundError\u001b[0m: ProviderModelNotFoundError',
  ' data: {',
  '  providerID: "openai",',
  '  modelID: "no-such-model",',
  '  suggestions: [],',
  ' },',
  '      at getModel (src/provider/provider.ts:1100:13)',
].join('\n');

/**
 * Verbatim, ANSI and all, from a real `--agent no-such-agent` run: opencode's
 * UI layer writes it straight to stderr, so it appears at every log level.
 */
const FELL_BACK =
  '\u001b[93m\u001b[1m! \u001b[0m agent "devsummary" not found. Falling back to default agent\n';

/**
 * A throttled OpenCode Zen call. The `service=llm` line is the reason
 * `stderrHint` may not simply take the first ERROR line: it embeds
 * `requestBodyValues.messages`, i.e. the system prompt and the commit diff.
 */
const RATE_LIMIT_MESSAGE =
  'Error from provider (Console): Rate limit exceeded. Please try again later.';
const PROMPT_SENTINEL = 'SECRET_PROMPT_TEXT';
const THROTTLED_STDERR = [
  `\u001b[31mERROR\u001b[0m 2026-09-09T02:25:38 +1ms service=llm error={"error":{"name":"AI_APICallError","requestBodyValues":{"messages":[{"role":"system","content":"${PROMPT_SENTINEL} answer only with JSON"}]}}}`,
  `\u001b[31mERROR\u001b[0m 2026-09-09T02:25:38 +3ms service=session.processor error=${RATE_LIMIT_MESSAGE} stack="AI_APICallError: ${RATE_LIMIT_MESSAGE}"`,
  '',
].join('\n');

const textEvent = (text: string) =>
  JSON.stringify({ type: 'text', part: { type: 'text', text } });

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });

const REQUEST = {
  model: 'opencode/big-pickle',
  systemPrompt: 'You classify commits.',
  jsonSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
  },
  schemaName: 'commit_analysis',
};

describe('opencodeAdapter.buildArgs', () => {
  it('runs the inline agent against the requested model', () => {
    expect(opencodeAdapter.buildArgs(REQUEST)).toEqual([
      'run',
      '--format',
      'json',
      // ERROR is the only level that is silent on a healthy call, and the only
      // place a throttled provider's reason is ever written.
      '--print-logs',
      '--log-level',
      'ERROR',
      '--agent',
      'devsummary',
      '--model',
      'opencode/big-pickle',
    ]);
  });

  // The prompt and the schema travel in the environment. Asserting both halves
  // rather than the absence of a flag: this fails if either moves onto argv,
  // which is the thing that must not happen (diffs reach 60k chars).
  it('carries the prompt and the schema in the env, never on argv', () => {
    const argv = opencodeAdapter.buildArgs(REQUEST).join(' ');
    const config = opencodeAdapter.env?.(REQUEST).OPENCODE_CONFIG_CONTENT ?? '';

    expect(argv).not.toContain(REQUEST.systemPrompt);
    expect(argv).not.toContain(REQUEST.schemaName);
    expect(argv).not.toContain(JSON.stringify(REQUEST.jsonSchema));
    expect(config).toContain(REQUEST.systemPrompt);
    expect(config).toContain(REQUEST.schemaName);
  });
});

// The system prompt and the tool policy both arrive here, because opencode has
// no flag for either: the agent is defined inline in the env var.
describe('opencodeAdapter.env', () => {
  const env = () => opencodeAdapter.env?.(REQUEST) ?? {};

  it('defines the agent inline, with every tool denied and sharing off', () => {
    const config = JSON.parse(env().OPENCODE_CONFIG_CONTENT);
    expect(config).toMatchObject({
      agent: {
        devsummary: {
          mode: 'primary',
          permission: { '*': 'deny' },
        },
      },
      share: 'disabled',
    });
    // Not `autoupdate: false`: the upgrade check reads the user's global config
    // file, not the merged one, so the key here would be inert.
    // `OPENCODE_DISABLE_AUTOUPDATE` is what does it.
    expect(config).not.toHaveProperty('autoupdate');
  });

  it('carries the caller’s system prompt and its JSON Schema in that prompt', () => {
    const config = JSON.parse(env().OPENCODE_CONFIG_CONTENT);
    const prompt: string = config.agent.devsummary.prompt;
    expect(prompt.startsWith('You classify commits.')).toBe(true);
    expect(prompt).toContain(JSON.stringify(REQUEST.jsonSchema));
    expect(prompt).toContain('commit_analysis');
  });

  it('opts the child out of the user’s project config and of autoupdate', () => {
    expect(env().OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
    expect(env().OPENCODE_DISABLE_AUTOUPDATE).toBe('1');
  });

  // The global instruction file is appended after our JSON instruction and
  // cannot be suppressed in 1.1.53; this keeps the user's personal Claude Code
  // memory from being the file that wins when they have no opencode AGENTS.md.
  it('keeps the user’s Claude Code memory out of the prompt', () => {
    expect(env().OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('1');
  });
});

describe('opencodeAdapter.parseOutput', () => {
  it('reads the answer out of the last text event and sums both token pairs', () => {
    expect(opencodeAdapter.parseOutput(ok(SUCCESS))).toEqual({
      ok: true,
      raw: { ok: true },
      // No event carries the resolved model id, so the client falls back to
      // the configured one.
      model: null,
      // 24704 + cache read + cache write: a cache hit is input too, and the
      // caller stores one number.
      promptTokens: 24704,
      // 186, **not** 186 + 128: the provider's `output_tokens` already
      // includes its reasoning tokens, which opencode then reports again under
      // `reasoning`. Summing them is the double count in opencode's own cost
      // display, and a wrong number on the usage card is worse than none.
      completionTokens: 186,
    });
  });

  it('unwraps a ```json fence the model added anyway', () => {
    const fenced = textEvent('```json\n{"ok":true}\n```');
    expect(opencodeAdapter.parseOutput(ok(fenced))).toMatchObject({
      ok: true,
      raw: { ok: true },
    });
  });

  // The stream is incremental: earlier text events are drafts of the same
  // message, and only the last one is the answer.
  it('takes the last text event when there are several', () => {
    const stdout = [
      textEvent('{"ok":false}'),
      textEvent('{"ok":true}'),
      '',
    ].join('\n');
    expect(opencodeAdapter.parseOutput(ok(stdout))).toMatchObject({
      ok: true,
      raw: { ok: true },
    });
  });

  it('reports null tokens when the stream carried no step_finish', () => {
    expect(
      opencodeAdapter.parseOutput(ok(textEvent('{"ok":true}'))),
    ).toMatchObject({ ok: true, promptTokens: null, completionTokens: null });
  });

  // **The exit code carries no information here.** A 401 from the provider is
  // an `error` event on stdout and a *clean* exit, so branching on the code
  // would report this run as a success with an unparseable body.
  it('maps an error event to transport with the provider’s own message, on a clean exit', () => {
    expect(opencodeAdapter.parseOutput(ok(ERROR_EVENT))).toEqual({
      ok: false,
      kind: 'transport',
      reason: API_KEY_MESSAGE,
    });
  });

  // Gated on the event, not on its payload: an `error` event with nothing in
  // it is still a failed run, and must not fall through to the answer path.
  it('reports a payload-less error event rather than looking for an answer', () => {
    const stdout = [
      JSON.stringify({ type: 'error', timestamp: 1788918444199 }),
      textEvent('{"ok":true}'),
    ].join('\n');
    expect(opencodeAdapter.parseOutput(ok(stdout))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'opencode reported an error',
    });
  });

  it('falls back to the generic reason for an empty error payload', () => {
    expect(
      opencodeAdapter.parseOutput(
        ok(JSON.stringify({ type: 'error', error: {} })),
      ),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'opencode reported an error',
    });
  });

  it('falls back to the error’s name when it carries no message', () => {
    const stdout = JSON.stringify({
      type: 'error',
      error: { name: 'UnknownError', data: {} },
    });
    expect(opencodeAdapter.parseOutput(ok(stdout))).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'UnknownError',
    });
  });

  // The process ran fine and the body is unusable, so it must not go back on
  // the retry path meant for network faults.
  it('maps a prose answer to invalid, not transport', () => {
    const stdout = textEvent('Sure! The commit looks like a chore.');
    expect(opencodeAdapter.parseOutput(ok(stdout))).toEqual({
      ok: false,
      kind: 'invalid',
      reason: 'answer was not JSON',
    });
  });

  // `transport`, not `invalid`: opencode fires its event loop off unawaited,
  // so a truncated stream is possible and a retry can produce the body.
  it('maps a stream that never answered to transport', () => {
    expect(
      opencodeAdapter.parseOutput(ok([STEP_START, STEP_FINISH].join('\n'))),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'opencode produced no answer',
    });
  });

  it.each([0, 1])(
    'reads the stripped stderr stack when stdout had no events (exit %i)',
    (code) => {
      expect(
        opencodeAdapter.parseOutput({
          code,
          stdout: '',
          stderr: NOT_FOUND_STDERR,
        }),
      ).toEqual({
        ok: false,
        kind: 'transport',
        reason: 'ProviderModelNotFoundError: ProviderModelNotFoundError',
      });
    },
  );

  it('falls back to the first stderr line when none names an error', () => {
    expect(
      opencodeAdapter.parseOutput({
        code: 1,
        stdout: '',
        stderr: 'error: unknown option --nope\nUsage: opencode run\n',
      }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'error: unknown option --nope',
    });
  });

  // The trust boundary. Without our agent there is no system prompt, no schema
  // and no `permission {'*': 'deny'}` — an unconstrained coding agent ran over
  // a commit diff in the backend's own working directory. The answer is refused
  // however well-formed it looks.
  it('refuses the run when opencode fell back to its default agent', () => {
    expect(
      opencodeAdapter.parseOutput({
        code: 0,
        stdout: SUCCESS,
        stderr: FELL_BACK,
      }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason:
        'opencode ignored the devsummary agent and ran with tools enabled',
    });
  });

  // The rate-limit case: opencode retries internally with backoff and emits no
  // event at all, so the log line is the only evidence there is.
  it('reads a throttled provider out of the ERROR log when stdout is empty', () => {
    expect(
      opencodeAdapter.parseOutput({
        code: null,
        stdout: '',
        stderr: THROTTLED_STDERR,
      }),
    ).toEqual({ ok: false, kind: 'transport', reason: RATE_LIMIT_MESSAGE });
  });

  it('still reports something when nothing was printed at all', () => {
    expect(
      opencodeAdapter.parseOutput({ code: 0, stdout: '', stderr: '' }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'opencode produced no output',
    });
  });

  // No events, nothing on stderr, and stdout is not JSON: whatever the CLI did
  // print is the most informative thing available.
  it('falls back to the first stdout line when there is nothing else', () => {
    expect(
      opencodeAdapter.parseOutput({
        code: 0,
        stdout: 'opencode: this command needs a model\nsee --help\n',
        stderr: '',
      }),
    ).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'opencode: this command needs a model',
    });
  });

  // The stream is not guaranteed to be JSON-only: a notice or a progress line
  // must not cost the answer that came after it.
  it('tolerates junk lines interleaved with the events', () => {
    const stdout = [
      'fetching models…',
      STEP_START,
      '{ not json',
      TEXT,
      '[]',
      STEP_FINISH,
    ].join('\n');
    expect(
      opencodeAdapter.parseOutput({ code: 0, stdout, stderr: '' }),
    ).toEqual({
      ok: true,
      raw: { ok: true },
      model: null,
      promptTokens: 24704,
      completionTokens: 186,
    });
  });
});

describe('opencodeAdapter.stderrHint', () => {
  it('quotes the provider’s sentence and nothing from the prompt', () => {
    const hint = opencodeAdapter.stderrHint?.(THROTTLED_STDERR);

    expect(hint).toBe(RATE_LIMIT_MESSAGE);
    // The `service=llm` line one above it embeds the whole request body. If
    // this hook ever widens to "the first ERROR line", a commit diff ends up in
    // a stored `failure_reason` and on screen.
    expect(hint).not.toContain(PROMPT_SENTINEL);
  });

  // One line per retry attempt; the last is the state the run died in.
  it('takes the last session error when the retry loop logged several', () => {
    const earlier = THROTTLED_STDERR.replace(
      RATE_LIMIT_MESSAGE,
      'Transient upstream hiccup',
    );
    expect(opencodeAdapter.stderrHint?.(earlier + THROTTLED_STDERR)).toBe(
      RATE_LIMIT_MESSAGE,
    );
  });

  // The unknown-model path has no session.processor line, so the existing
  // stack-trace reason above is still the one that answers for it.
  it('is null for stderr that carries no session error', () => {
    expect(opencodeAdapter.stderrHint?.(NOT_FOUND_STDERR)).toBeNull();
    expect(opencodeAdapter.stderrHint?.('')).toBeNull();
  });
});

describe('AGENT_ADAPTERS', () => {
  it('registers OpenCode under its provider id', () => {
    expect(AGENT_ADAPTERS.opencode).toBe(opencodeAdapter);
    expect(opencodeAdapter.id).toBe('opencode');
    expect(opencodeAdapter.binary).toBe('opencode');
    expect(opencodeAdapter.versionArgs).toEqual(['--version']);
  });

  // Credentials are per provider *inside* opencode, so there is no single
  // "logged in" state to probe and the card reports none.
  it('has no auth probe', () => {
    expect(opencodeAdapter.authArgs).toBeUndefined();
    expect(opencodeAdapter.parseAuth).toBeUndefined();
  });

  it('is keyed for every CLI', () => {
    expect(isAgentProvider('opencode')).toBe(true);
    expect(Object.keys(AGENT_ADAPTERS).sort()).toEqual([
      'claude-code',
      'cursor',
      'opencode',
    ]);
  });
});
