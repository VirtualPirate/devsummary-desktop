import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentCliDetector,
  claudeCodeAdapter,
  type CliResult,
  type RunCli,
} from '..';

const VERSION_OUT = '2.1.265 (Claude Code)\n';
const AUTH_OUT = '{"loggedIn":true,"authMethod":"claude.ai"}\n';

const done = (stdout: string, code = 0): CliResult => ({
  code,
  stdout,
  stderr: '',
  timedOut: false,
});

/** Records every spawn the detector asks for, and answers by argv. */
function recorder(
  answer: (file: string, args: string[]) => Promise<CliResult>,
) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: RunCli = (file, args) => {
    calls.push({ file, args });
    return answer(file, args);
  };
  return { run, calls };
}

let savedPath: string | undefined;
let savedShell: string | undefined;
let emptyDir: string;

beforeEach(async () => {
  savedPath = process.env.PATH;
  savedShell = process.env.SHELL;
  emptyDir = await mkdtemp(join(tmpdir(), 'agent-cli-empty-'));
  process.env.PATH = emptyDir;
  process.env.SHELL = '/bin/zsh';
});

afterEach(() => {
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  if (savedShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = savedShell;
});

describe('AgentCliDetector.detect', () => {
  // Headless dev and CI find the binary on the inherited PATH, and must not
  // pay for a login shell to learn that.
  it('finds an executable on process.env.PATH without spawning a shell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-cli-bin-'));
    const bin = join(dir, 'claude');
    await writeFile(bin, '#!/bin/sh\n');
    await chmod(bin, 0o755);
    process.env.PATH = `${dir}:${emptyDir}`;

    const { run, calls } = recorder((_file, args) =>
      Promise.resolve(done(args[0] === '--version' ? VERSION_OUT : AUTH_OUT)),
    );

    expect(await new AgentCliDetector(run).detect('claude-code')).toEqual({
      id: 'claude-code',
      displayName: 'Claude Code',
      installed: true,
      path: bin,
      version: '2.1.265 (Claude Code)',
      authenticated: true,
      installHint: claudeCodeAdapter.installHint,
    });
    expect(calls.map((c) => c.args)).toEqual([
      ['--version'],
      ['auth', 'status'],
    ]);
  });

  // An Electron GUI process inherits a minimal PATH with no ~/.local/bin and
  // no nvm, so the binary the user installed is invisible until their profile
  // has run. `-l` sources it; `-i` runs .zshrc, where most people export PATH.
  it('falls back to the login shell and takes the last line of stdout', async () => {
    const { run, calls } = recorder((file, args) => {
      if (file === '/bin/zsh') {
        expect(args).toEqual(['-lic', 'command -v claude']);
        return Promise.resolve(
          done('nvm: loaded\n/Users/dev/.local/bin/claude\n'),
        );
      }
      return Promise.resolve(
        done(args[0] === '--version' ? VERSION_OUT : AUTH_OUT),
      );
    });

    expect(await new AgentCliDetector(run).detect('claude-code')).toMatchObject(
      {
        installed: true,
        path: '/Users/dev/.local/bin/claude',
        version: '2.1.265 (Claude Code)',
      },
    );
    expect(calls[0]?.file).toBe('/bin/zsh');
  });

  it('is not installed when the login shell finds nothing', async () => {
    const { run } = recorder(() => Promise.resolve(done('', 1)));

    expect(await new AgentCliDetector(run).detect('claude-code')).toMatchObject(
      {
        installed: false,
        path: null,
        version: null,
        authenticated: null,
      },
    );
  });

  it('ignores a shell answer that is not an absolute path', async () => {
    const { run } = recorder(() => Promise.resolve(done('claude: aliased\n')));

    expect(await new AgentCliDetector(run).detect('claude-code')).toMatchObject(
      {
        installed: false,
        path: null,
      },
    );
  });

  // The Codex case on this machine: `command -v codex` succeeds and spawning it
  // fails ENOENT on a missing vendored binary. A path is not a working binary.
  it('reports not installed when a located binary cannot be spawned', async () => {
    const { run } = recorder((file) =>
      file === '/bin/zsh'
        ? Promise.resolve(done('/usr/local/bin/claude\n'))
        : Promise.reject(
            Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
          ),
    );

    expect(await new AgentCliDetector(run).detect('claude-code')).toMatchObject(
      {
        installed: false,
        path: '/usr/local/bin/claude',
        version: null,
        authenticated: null,
      },
    );
  });

  it('reports not installed when --version exits non-zero', async () => {
    const { run } = recorder((file, args) =>
      file === '/bin/zsh'
        ? Promise.resolve(done('/usr/local/bin/claude\n'))
        : Promise.resolve(done('', args[0] === '--version' ? 2 : 0)),
    );

    expect(await new AgentCliDetector(run).detect('claude-code')).toMatchObject(
      {
        installed: false,
        version: null,
      },
    );
  });

  it('reports authenticated false when the login probe fails', async () => {
    const { run } = recorder((file, args) => {
      if (file === '/bin/zsh')
        return Promise.resolve(done('/usr/bin/claude\n'));
      if (args[0] === '--version') return Promise.resolve(done(VERSION_OUT));
      return Promise.reject(new Error('auth blew up'));
    });

    expect(await new AgentCliDetector(run).detect('claude-code')).toMatchObject(
      {
        installed: true,
        authenticated: false,
      },
    );
  });
});

describe('AgentCliDetector caching', () => {
  function installed() {
    return recorder((file, args) => {
      if (file === '/bin/zsh')
        return Promise.resolve(done('/usr/bin/claude\n'));
      return Promise.resolve(
        done(args[0] === '--version' ? VERSION_OUT : AUTH_OUT),
      );
    });
  }

  it('serves a second detect from the cache', async () => {
    const { run, calls } = installed();
    const detector = new AgentCliDetector(run);

    await detector.detect('claude-code');
    await detector.detect('claude-code');

    expect(calls).toHaveLength(3);
  });

  it('re-probes when force is set', async () => {
    const { run, calls } = installed();
    const detector = new AgentCliDetector(run);

    await detector.detect('claude-code');
    await detector.detect('claude-code', { force: true });

    expect(calls).toHaveLength(6);
  });

  it('re-probes once the 60 s TTL has passed', async () => {
    const { run, calls } = installed();
    const detector = new AgentCliDetector(run);
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);

    await detector.detect('claude-code');
    now.mockReturnValue(59_000);
    await detector.detect('claude-code');
    expect(calls).toHaveLength(3);

    now.mockReturnValue(61_000);
    await detector.detect('claude-code');
    expect(calls).toHaveLength(6);
    now.mockRestore();
  });

  // Commit analysis fans out five at a time and every one of them asks for the
  // binary before it spawns. Five login shells for one answer is the cost this
  // avoids.
  it('collapses concurrent probes into one', async () => {
    const { run, calls } = installed();
    const detector = new AgentCliDetector(run);

    await Promise.all([
      detector.detect('claude-code'),
      detector.detect('claude-code'),
      detector.detect('claude-code'),
    ]);

    expect(calls).toHaveLength(3);
  });
});

describe('AgentCliDetector force races', () => {
  /** A `CliResult` the test releases by hand, to hold a probe mid-flight. */
  function deferred() {
    let release: (result: CliResult) => void = () => {};
    const promise = new Promise<CliResult>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  /** Yields to the event loop, which a microtask spin would never do. */
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  // A background probe stuck in a login shell must not stamp its stale answer
  // over the refresh that overtook it: the point of `force` is to show the CLI
  // the user just installed, not to make them wait out another TTL for it.
  it('keeps the forced result when the probe it raced answers later', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-cli-bin-'));
    const bin = join(dir, 'claude');
    const shell = deferred();
    const { run, calls } = recorder((file, args) =>
      file === '/bin/zsh'
        ? shell.promise
        : Promise.resolve(
            done(args[0] === '--version' ? VERSION_OUT : AUTH_OUT),
          ),
    );
    const detector = new AgentCliDetector(run);

    // Nothing on PATH yet, so this probe goes to the login shell and waits there.
    const stale = detector.detect('claude-code');

    // The user installs the CLI and hits refresh; PATH answers immediately.
    await writeFile(bin, '#!/bin/sh\n');
    await chmod(bin, 0o755);
    process.env.PATH = `${dir}:${emptyDir}`;
    expect(await detector.detect('claude-code', { force: true })).toMatchObject(
      {
        installed: true,
        path: bin,
      },
    );

    // Only now does the shell come back, with the answer from before the install.
    shell.release(done('', 1));
    expect(await stale).toMatchObject({ installed: false, path: null });

    const spawned = calls.length;
    expect(await detector.detect('claude-code')).toMatchObject({
      installed: true,
      path: bin,
    });
    expect(calls).toHaveLength(spawned);
  });

  // Losing the race must not cost the winner its dedupe either: while the forced
  // probe is still running, a fan-out has to keep collapsing onto it rather than
  // paying for a login shell each.
  it('leaves the current probe in flight when an older one settles first', async () => {
    const held = [deferred(), deferred()];
    let nth = 0;
    const { run, calls } = recorder((file) => {
      if (file !== '/bin/zsh') return Promise.resolve(done(VERSION_OUT));
      // Any shell past the two this test drives belongs to a probe the fix
      // should have prevented; answer it at once so the count below fails
      // instead of the test hanging.
      return nth < held.length
        ? held[nth++].promise
        : Promise.resolve(done('', 1));
    });
    const shellCalls = () => calls.filter((c) => c.file === '/bin/zsh');
    const detector = new AgentCliDetector(run);
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);

    const stale = detector.detect('claude-code');
    while (shellCalls().length < 1) await tick();
    const forced = detector.detect('claude-code', { force: true });
    while (shellCalls().length < 2) await tick();

    // The older probe answers first. Expiring the clock past its write is what
    // makes the next assertion about in-flight bookkeeping and not the cache.
    held[0].release(done('', 1));
    expect(await stale).toMatchObject({ installed: false });
    now.mockReturnValue(61_000);

    const fanout = Promise.all([
      detector.detect('claude-code'),
      detector.detect('claude-code'),
    ]);
    held[1].release(done('', 1));
    const winner = await forced;

    expect(shellCalls()).toHaveLength(2);
    for (const status of await fanout) expect(status).toBe(winner);
    now.mockRestore();
  });
});

describe('AgentCliDetector.binaryPath and detectAll', () => {
  it('returns the path for an installed CLI, off the same cache', async () => {
    const { run, calls } = recorder((file, args) =>
      file === '/bin/zsh'
        ? Promise.resolve(done('/usr/bin/claude\n'))
        : Promise.resolve(
            done(args[0] === '--version' ? VERSION_OUT : AUTH_OUT),
          ),
    );
    const detector = new AgentCliDetector(run);

    expect(await detector.binaryPath(claudeCodeAdapter)).toBe(
      '/usr/bin/claude',
    );
    expect(await detector.binaryPath(claudeCodeAdapter)).toBe(
      '/usr/bin/claude',
    );
    expect(calls).toHaveLength(3);
  });

  it('returns null when the binary is located but cannot run', async () => {
    const { run } = recorder((file) =>
      file === '/bin/zsh'
        ? Promise.resolve(done('/usr/bin/claude\n'))
        : Promise.resolve(done('', 1)),
    );

    expect(
      await new AgentCliDetector(run).binaryPath(claudeCodeAdapter),
    ).toBeNull();
  });

  it('detectAll answers one status per registered adapter', async () => {
    const { run } = recorder(() => Promise.resolve(done('', 1)));

    expect(await new AgentCliDetector(run).detectAll()).toEqual([
      expect.objectContaining({ id: 'claude-code', installed: false }),
      expect.objectContaining({ id: 'opencode', installed: false }),
      expect.objectContaining({ id: 'cursor', installed: false }),
    ]);
  });
});
