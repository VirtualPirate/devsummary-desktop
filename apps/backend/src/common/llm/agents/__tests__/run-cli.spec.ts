import { claudeCodeAdapter, runCli } from '..';
import {
  SECRET_KEYS,
  type SecretKey,
} from '../../../../local/settings/secrets.service';

/**
 * The only spec in this folder that spawns for real: both findings below are
 * about what Node's `execFile` does to a live child, and a stub of `execFile`
 * would only assert the assumption under test. Kept to a few hundred ms of wall
 * time by shrinking the timeout and the kill grace instead of waiting them out.
 */
const TRAPS_SIGTERM = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";

describe('runCli', () => {
  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const started = Date.now();

    const result = await runCli(process.execPath, ['-e', TRAPS_SIGTERM], {
      timeoutMs: 150,
      killGraceMs: 150,
    });

    // Without the escalation this promise never settles and the slot its caller
    // holds is gone until the backend restarts.
    expect(result).toMatchObject({ code: null, timedOut: true });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reports an output overflow as an overflow rather than a timeout', async () => {
    const result = await runCli(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(10000))"],
      { timeoutMs: 5_000, maxBuffer: 64 },
    );

    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe('output exceeded 64 bytes');
    // The reason a caller sees: a failed process, not a retryable blip's twin.
    expect(claudeCodeAdapter.parseOutput(result)).toEqual({
      ok: false,
      kind: 'transport',
      reason: 'output exceeded 64 bytes',
    });
  });

  // A merge, not a replacement: OpenCode's whole agent definition arrives this
  // way, and the child still has to find its own binary, config and home.
  it('merges the caller’s env over the parent’s rather than replacing it', async () => {
    const result = await runCli(
      process.execPath,
      [
        '-e',
        'process.stdout.write(`${process.env.X_PROBE}|${!!process.env.PATH}`)',
      ],
      { timeoutMs: 5_000, env: { X_PROBE: 'from-the-adapter' } },
    );

    expect(result.stdout).toBe('from-the-adapter|true');
  });

  // The trust boundary for every adapter at once: `SecretsService` puts the
  // decrypted bundle in `process.env`, and the child is a model running on an
  // untrusted commit diff.
  describe('the credential bundle', () => {
    const CANARIES: SecretKey[] = [
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'DB_ENCRYPTION_KEY',
      'SLACK_BOT_TOKEN',
    ];
    const saved = new Map<string, string | undefined>();

    beforeEach(() => {
      for (const key of SECRET_KEYS) {
        saved.set(key, process.env[key]);
        delete process.env[key];
      }
      for (const key of CANARIES) process.env[key] = `canary-${key}`;
    });

    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      saved.clear();
    });

    const echo = (keys: readonly string[]) =>
      runCli(
        process.execPath,
        [
          '-e',
          `process.stdout.write(${JSON.stringify(keys)}.map((k) => String(process.env[k])).join('|'))`,
        ],
        { timeoutMs: 5_000 },
      );

    it('never reaches the child', async () => {
      const result = await echo(SECRET_KEYS);

      // Not "no canary": every key on the list, whether or not this test set
      // one, so a key added to the bundle later cannot quietly skip the strip.
      expect(result.stdout.split('|')).toEqual(
        SECRET_KEYS.map(() => 'undefined'),
      );
    });

    it('still leaves the child the environment it needs to run', async () => {
      const result = await echo(['PATH', 'HOME']);

      expect(result.stdout).not.toContain('undefined');
    });

    it('lets an adapter pass one explicitly rather than inheriting it', async () => {
      const result = await runCli(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.env.OPENAI_API_KEY))'],
        { timeoutMs: 5_000, env: { OPENAI_API_KEY: 'chosen-by-the-adapter' } },
      );

      expect(result.stdout).toBe('chosen-by-the-adapter');
    });
  });
});
