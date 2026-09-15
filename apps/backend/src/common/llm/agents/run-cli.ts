import { execFile, type ExecFileException } from 'node:child_process';
import { SECRET_KEYS } from '../../../local/settings/secrets.service';

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
  /** Merged over the sanitized parent environment, never replacing it — the
   *  child still has to find its own config and home. An adapter that genuinely
   *  needs one of `SECRET_KEYS` has to name it here; inheriting it is what
   *  `childEnv` refuses. */
  env?: Record<string, string>;
  /**
   * Where to run the child. Every agent CLI reads its working directory's
   * instruction files into the model prompt, so a caller that has a scratch
   * directory passes it here. Must exist: a missing cwd is a spawn failure.
   */
  cwd?: string;
}

/**
 * The child's environment: the parent's, minus the credential bundle.
 *
 * `SecretsService` writes the decrypted bundle — the GitHub PAT, the provider
 * key, `DB_ENCRYPTION_KEY`, the Slack bot token — straight into this process's
 * `process.env`, because that is the seam every consumer reads through. Every
 * child forked here inherits that by default, and these children are agent CLIs
 * running a model whose prompt is an untrusted commit diff. Codex already
 * refused the inheritance through its own config (`shell_environment_policy`
 * plus `allow_login_shell=false`); the other three adapters had no equivalent,
 * and neither did the detector's `$SHELL -lic` probe. Stripping it at the one
 * spawn they all go through is what covers them together — and keeps covering a
 * fifth adapter nobody has written yet.
 *
 * A deny-list, not an allow-list: a CLI still has to find its own login, config,
 * cache and home, and those live in variables no list here could enumerate.
 * Codex's flags stay regardless — they also deny the user's *own* profile
 * secrets, which are re-sourced inside the child and are not ours to strip.
 *
 * `opts.env` is merged after the strip, not before, so an adapter that has a
 * real need for one of these keys states it explicitly instead of inheriting it
 * silently. None does today.
 */
function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SECRET_KEYS) delete env[key];
  return extra ? { ...env, ...extra } : env;
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
        cwd: opts.cwd,
        env: childEnv(opts.env),
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
