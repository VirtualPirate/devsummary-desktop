/**
 * Electron's `utilityProcess.fork` gives the child a `process.parentPort`. Under
 * plain `node` (headless dev, tests, `nest start`) it is absent — every caller
 * must treat that as "the desktop shell is not there", never as an error to
 * swallow.
 */
export interface ParentPort {
  postMessage(message: unknown): void;
}

export function parentPort(): ParentPort | null {
  return (process as unknown as { parentPort?: ParentPort }).parentPort ?? null;
}
