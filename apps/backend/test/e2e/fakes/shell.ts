export interface ShellFake {
  /** Every message the backend posted to the Electron shell. */
  messages: Array<Record<string, unknown>>;
  /** Make `postMessage` throw, i.e. a shell that is going away. */
  throwOnPost(error: Error): void;
  /** Remove the port — the headless default every other spec file runs in. */
  detach(): void;
  /** Put the port back after `detach()`, so later tests can still notify. */
  attach(): void;
  restore(): void;
}

type MutableProcess = NodeJS.Process & {
  parentPort?: { postMessage: (message: unknown) => void };
};

/**
 * `parentPort()` reads `process.parentPort` at call time and returns null under
 * plain node, so the desktop channel needs no alias — assigning the property is
 * the whole seam. Without this, every e2e run only ever exercises the desktop
 * channel's *failure* path.
 */
export function installShell(): ShellFake {
  const proc = process as MutableProcess;
  const messages: Array<Record<string, unknown>> = [];
  let thrown: Error | null = null;

  const attach = () => {
    proc.parentPort = {
      postMessage: (message: unknown) => {
        if (thrown) throw thrown;
        messages.push(message as Record<string, unknown>);
      },
    };
  };
  attach();

  return {
    messages,
    throwOnPost: (error) => {
      thrown = error;
    },
    detach: () => {
      delete proc.parentPort;
    },
    attach,
    restore: () => {
      thrown = null;
      messages.length = 0;
      delete proc.parentPort;
    },
  };
}
