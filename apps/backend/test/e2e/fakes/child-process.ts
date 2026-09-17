// The bare specifier, deliberately: `vitest.e2e.config.ts` aliases only
// `node:child_process`, so this reaches the real module and cannot recurse.
// An explicit local export shadows a star export of the same name, so the
// `execFile` below is the one importers get and everything else passes through.
export * from 'child_process';

export interface CliInvocation {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  stdin?: string;
}

export interface CliAnswer {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Simulates a child killed by the timeout: resolves as `timedOut`. */
  killed?: boolean;
}

export type CliStub = (call: CliInvocation) => CliAnswer | Promise<CliAnswer>;

export const __execFileCalls: CliInvocation[] = [];
let stub: CliStub | null = null;

export function __setExecFile(next: CliStub | null): void {
  stub = next;
  __execFileCalls.length = 0;
}

type Callback = (
  err: (Error & { code?: number | string; killed?: boolean }) | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * Enough of `execFile` for `run-cli.ts`: the four-argument form, a child with
 * `kill()` and a writable `stdin`, and the three ways Node reports an outcome —
 * success, a numeric exit code on `err.code`, and `err.killed` for a timeout.
 *
 * A spec that has installed no stub gets a rejection rather than a spawn: an
 * unstubbed CLI call in this suite is a bug, and a silent empty answer is how a
 * wrong assertion passes.
 */
export function execFile(
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string },
  callback: Callback,
) {
  const call: CliInvocation = {
    file,
    args,
    env: options.env ?? {},
    cwd: options.cwd,
  };
  __execFileCalls.push(call);

  const active = stub;
  // Deferred so the caller can attach stdin first, exactly as a real spawn does.
  setImmediate(() => {
    void (async () => {
      if (!active) {
        callback(
          Object.assign(new Error(`child_process fake: no stub for ${file}`), {
            code: 'ENOENT',
          }),
          '',
          '',
        );
        return;
      }
      const answer = await active(call);
      if (answer.killed) {
        callback(
          Object.assign(new Error('killed'), { killed: true }),
          answer.stdout,
          answer.stderr,
        );
        return;
      }
      if (answer.code === 0) {
        callback(null, answer.stdout, answer.stderr);
        return;
      }
      callback(
        Object.assign(new Error(`${file} exited with ${answer.code}`), {
          code: answer.code ?? 1,
        }),
        answer.stdout,
        answer.stderr,
      );
    })();
  });

  return {
    kill: () => true,
    stdin: {
      on: () => undefined,
      end: (data?: string) => {
        call.stdin = data;
      },
    },
  };
}
