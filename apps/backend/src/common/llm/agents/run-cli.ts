import { execFile, type ExecFileException } from 'node:child_process';

/** 16 MiB: a JSON envelope wrapping a brief, with room to spare. */
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export interface CliResult {
  /** `null` only when the process was killed rather than exiting. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CliOptions {
  timeoutMs: number;
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
    const child = execFile(
      file,
      args,
      {
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: process.env,
        encoding: 'utf8',
      },
      (err: ExecFileException | null, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr, timedOut: false });
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

    if (opts.stdin !== undefined) {
      // A child that dies before it reads makes this write EPIPE, which is an
      // unhandled 'error' event and would take the backend down with it. The
      // real failure is already on its way through the callback.
      child.stdin?.on('error', () => {});
      child.stdin?.end(opts.stdin);
    }
  });
