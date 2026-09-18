import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { AgentCliStatus } from '@launchstack/api-interfaces';
import {
  AGENT_ADAPTERS,
  AGENT_PROVIDERS,
  type AgentCliAdapter,
  type AgentProvider,
} from './agent-cli.adapter';
import { runCli, type RunCli } from './run-cli';

export type { AgentCliStatus };

/** Long enough that a fan-out of jobs pays for one probe, short enough that a
 *  fresh install shows up without a relaunch. */
const TTL_MS = 60_000;
/** A login shell sources the whole profile; 5 s is generous for that. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * What a Windows user is told instead of an install command, because
 * installing would not help.
 */
const WINDOWS_HINT =
  'Agent CLI providers are not available on Windows yet — DevSummary spawns the CLI itself, and that path is macOS/Linux only. Use OpenAI or Gemini with an API key instead.';

/**
 * Whether an agent CLI can run here. A plain class with a module-level
 * singleton rather than a Nest provider: `BriefsModule` and
 * `CommitAnalysisModule` do not import `LocalSettingsModule`, and threading a
 * provider through three module graphs buys nothing over a singleton holding a
 * 60 s cache. Tests construct their own with an injected runner.
 *
 * Nothing user-supplied ever reaches argv here, and nothing goes on the wire.
 */
export class AgentCliDetector {
  private readonly cache = new Map<
    AgentProvider,
    { at: number; status: AgentCliStatus }
  >();
  private readonly inflight = new Map<AgentProvider, Promise<AgentCliStatus>>();

  constructor(private readonly run: RunCli = runCli) {}

  async detect(
    id: AgentProvider,
    opts: { force?: boolean } = {},
  ): Promise<AgentCliStatus> {
    const hit = this.cache.get(id);
    if (!opts.force && hit && Date.now() - hit.at < TTL_MS) return hit.status;

    // Commit analysis asks five times at once on a cold cache; one probe is
    // the whole point of the cache.
    const pending = this.inflight.get(id);
    if (pending && !opts.force) return pending;

    // Only the newest probe owns the cache entry. A `force` probe that finds the
    // binary on PATH answers in microseconds and can easily beat the probe it
    // raced, which may still be inside a login shell; letting the loser write
    // would stamp its stale answer over the fresher one for a whole fresh TTL,
    // so an explicit refresh would show "not installed" for another minute. The
    // loser still returns its own answer to its own caller — it just does not
    // get to speak for the cache, or to evict someone else's in-flight entry.
    const probe: Promise<AgentCliStatus> = this.probe(AGENT_ADAPTERS[id])
      .then((status) => {
        if (this.inflight.get(id) === probe) {
          this.cache.set(id, { at: Date.now(), status });
        }
        return status;
      })
      .finally(() => {
        if (this.inflight.get(id) === probe) this.inflight.delete(id);
      });
    this.inflight.set(id, probe);
    return probe;
  }

  detectAll(force = false): Promise<AgentCliStatus[]> {
    return Promise.all(AGENT_PROVIDERS.map((id) => this.detect(id, { force })));
  }

  /** The path a call should spawn, or null. Reads the same cache. */
  async binaryPath(adapter: AgentCliAdapter): Promise<string | null> {
    const status = await this.detect(adapter.id);
    return status.installed ? status.path : null;
  }

  private async probe(adapter: AgentCliAdapter): Promise<AgentCliStatus> {
    const base = {
      id: adapter.id,
      displayName: adapter.displayName,
      installHint: adapter.installHint,
    };

    // Windows: report absent rather than ship three unverifiable guesses.
    // `$SHELL -lic` having no meaning there is the visible half and the least
    // of it — `locate` also walks PATH for a bare `claude` where the file is
    // `claude.cmd`, `X_OK` is not a permission Windows has, and `execFile`
    // refuses to spawn a `.cmd` at all since Node's CVE-2024-27980 fix, so
    // even a located shim would fail. This app has never launched on Windows
    // (`docs/RELEASE-CHECKLIST.md` §2), so none of those fixes could be tested.
    //
    // Absent is a state every caller already handles: the card shows the hint
    // instead of an install command, `Use <CLI>` stays disabled, and
    // `binaryPath` answers null — so a provider forced through `LLM_PROVIDER`
    // fails at the call instead of spawning something. OpenAI and Gemini need
    // no binary and are unaffected.
    if (process.platform === 'win32') {
      return {
        ...base,
        installHint: WINDOWS_HINT,
        installed: false,
        path: null,
        version: null,
        authenticated: null,
      };
    }

    const path = await this.locate(adapter.binary);
    if (!path) {
      return {
        ...base,
        installed: false,
        path: null,
        version: null,
        authenticated: null,
      };
    }

    // A located binary is not a working one: `command -v codex` succeeds on
    // this machine and spawning it fails ENOENT on a missing vendored binary.
    // Running it is the only proof.
    const unrunnable = {
      ...base,
      installed: false,
      path,
      version: null,
      authenticated: null,
    };
    let version: string | null;
    try {
      const result = await this.run(path, adapter.versionArgs, {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (result.code !== 0) return unrunnable;
      version = result.stdout.trim().split('\n')[0]?.trim() || null;
    } catch {
      return unrunnable;
    }

    return {
      ...base,
      installed: true,
      path,
      version,
      authenticated: await this.authenticated(adapter, path),
    };
  }

  private async authenticated(
    adapter: AgentCliAdapter,
    path: string,
  ): Promise<boolean | null> {
    if (!adapter.authArgs || !adapter.parseAuth) return null;
    try {
      const result = await this.run(path, adapter.authArgs, {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      // stderr only when stdout said nothing: `codex login status` prints its
      // one line there, and reading stdout alone reported every logged-in user
      // as signed out (`docs/receipts/AGENT-CLI-CODEX.md`). An adapter that
      // answers on stdout never reaches the fallback, and one that cannot
      // parse what it is given already returns false.
      return adapter.parseAuth(result.stdout.trim() || result.stderr);
    } catch {
      return false;
    }
  }

  /**
   * `process.env.PATH` first — headless dev and the test suite find it there
   * and must not pay for a shell. Then the user's login shell: an Electron GUI
   * process inherits a minimal PATH with no `~/.local/bin` and no nvm, so a
   * binary the user installed is invisible until their profile has run. `-l`
   * sources the profile, `-i` runs `.zshrc`, which is where most people
   * actually export PATH.
   */
  private async locate(binary: string): Promise<string | null> {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, binary);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not in this directory.
      }
    }

    const shell = process.env.SHELL ?? '/bin/zsh';
    try {
      const result = await this.run(shell, ['-lic', `command -v ${binary}`], {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (result.code !== 0) return null;
      // An interactive shell prints its own noise first, so take the last line
      // — and only if it is a path. `command -v` answers a bare name for a
      // shell function or alias, which is not something to spawn.
      const lines = result.stdout.trim().split('\n');
      const found = lines[lines.length - 1]?.trim() ?? '';
      return found.startsWith('/') ? found : null;
    } catch {
      return null;
    }
  }
}

/** One cache per process. */
export const agentCliDetector = new AgentCliDetector();
