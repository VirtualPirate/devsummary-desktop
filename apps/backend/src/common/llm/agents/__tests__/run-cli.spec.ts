import { claudeCodeAdapter, runCli } from '..';

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
});
