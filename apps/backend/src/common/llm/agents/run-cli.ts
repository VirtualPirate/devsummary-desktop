import { execFile, type ExecFileException } from 'node:child_process';

/** 16 MiB: a JSON envelope wrapping a brief, with room to spare. */
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/** How long a SIGTERM'd child has to die before it is killed outright. */
const DEFAULT_KILL_GRACE_MS = 5_000;

export interface CliResult {
  /** `null` only when the process was killed rather than exiting. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CliOptions {
  timeoutMs: number;
  /** Grace after `timeoutMs` before SIGKILL. Only tests shorten it. */
  killGraceMs?: number;
  maxBuffer?: number;
  /**
   * Written to the child's stdin and closed. Prompts reach 60k chars, so they
   * never go on argv — there are no length limits or quoting rules here.
   */
  stdin?: string;
}

export type RunCli = (
  file: string,
  args: string[],
  opts: CliOptions,
) => Promise<CliResult>;

/**
 * The one spawn in this folder, injected everywhere it is used so no test ever
 * starts a process.
 *
 * A non-zero exit and a timeout both arrive as an error from `execFile` and are
 * resolved, not thrown: they are answers the caller has to interpret. Only a
 * *spawn* failure (ENOENT on a binary that a PATH lookup found) rejects, which
 * is the one case that means "this is not a working CLI".
 */
export const runCli: RunCli = (file, args, opts) =>
  new Promise<CliResult>((resolve, reject) => {
    const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;

    const child = execFile(
      file,
      args,
      {
        timeout: opts.timeoutMs,
        maxBuffer,
        env: process.env,
        encoding: 'utf8',
      },
      (err: ExecFileException | null, stdout, stderr) => {
        clearTimeout(escalate);
        if (!err) {
          resolve({ code: 0, stdout, stderr, timedOut: false });
          return;
        }
        // Node kills the child to stop reading it, so an overflow arrives
        // looking like every other killed process. It is not a slow answer and
        // must not be reported as one: waiting longer would never help, and the
        // stderr line is what the user sees as the reason.
        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolve({
            code: null,
            stdout,
            stderr: `output exceeded ${maxBuffer} bytes`,
            timedOut: false,
          });
          return;
        }
        if (err.killed) {
          resolve({ code: null, stdout, stderr, timedOut: true });
          return;
        }
        if (typeof err.code === 'number') {
          resolve({ code: err.code, stdout, stderr, timedOut: false });
          return;
        }
        // `ExecFileException` is an intersection of `Omit`s, so it is Error-
        // shaped without being an Error subtype — @types/node says outright
        // that it "accurately describes none of them". Node does pass a real
        // Error here; the guard proves it without a cast, and keeps the stack.
        reject(
          err instanceof Error
            ? err
            : new Error(`${file} could not be spawned`, { cause: err }),
        );
      },
    );

    // Declared after the spawn because it needs the child, and read from the
    // callback above, which cannot run before this statement does.
    //
    // `execFile`'s own `timeout` sends SIGTERM once and then waits for `close`.
    // A child that traps SIGTERM never closes, so the callback never fires,
    // this promise never settles, and the caller's `finally` never gives its
    // semaphore slot back — two of those wedge the client until a restart. So
    // follow up with the one signal nothing can trap. `unref` because a pending
    // escalation must not be a reason for the process to stay alive.
    const escalate = setTimeout(
      () => child.kill('SIGKILL'),
      opts.timeoutMs + (opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS),
    );
    escalate.unref();

    if (opts.stdin !== undefined) {
      // A child that dies before it reads makes this write EPIPE, which is an
      // unhandled 'error' event and would take the backend down with it. The
      // real failure is already on its way through the callback.
      child.stdin?.on('error', () => {});
      child.stdin?.end(opts.stdin);
    }
  });
