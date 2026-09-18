/**
 * Resolved once, before `createRoot().render()`, because the backend's port is
 * assigned by the OS at boot and only the Electron main process knows it.
 *
 * Two shapes, one contract:
 * - inside the shell, `window.desktop.apiConfig()` answers `{ port, token }`;
 * - headless (a bare `vite dev`, or a test driving the bundle in a browser),
 *   `VITE_API_BASE_URI` + optional `VITE_DESKTOP_TOKEN` stand in.
 */
export interface AppConfig {
  baseURL: string;
  token: string;
}

declare global {
  interface Window {
    desktop?: {
      apiConfig(): Promise<{ port: number; token: string }>;
      openExternal(url: string): Promise<void>;
      /** Resolves to `shell.openPath`'s error string — empty when it opened. */
      openDataDir(): Promise<string>;
      consentState(): Promise<{ acceptedVersion: string | null; acceptedAt: string | null }>;
      acceptConsent(termsVersion: string): Promise<void>;
      quitApp(): Promise<void>;
    };
  }
}

let config: AppConfig = { baseURL: "", token: "" };

export const getAppConfig = (): AppConfig => config;

export async function resolveAppConfig(): Promise<AppConfig> {
  if (window.desktop) {
    const { port, token } = await window.desktop.apiConfig();
    config = { baseURL: `http://127.0.0.1:${port}`, token };
  } else {
    config = {
      baseURL: import.meta.env["VITE_API_BASE_URI"] ?? "http://127.0.0.1:3000",
      token: import.meta.env["VITE_DESKTOP_TOKEN"] ?? "",
    };
  }
  return config;
}

/**
 * Which terms version this install has accepted, resolved before the first render
 * so there is never a frame where the app is interactive ungated.
 *
 * `null` means "ask". Headless (a bare `vite dev`, no `window.desktop`) resolves to
 * the current version: there is no app to quit and no file to write, and a gate the
 * user cannot get past is not a useful dev experience.
 */
export interface ConsentSnapshot {
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

let consent: ConsentSnapshot = { acceptedVersion: null, acceptedAt: null };

export const getConsent = (): ConsentSnapshot => consent;

export async function resolveConsent(currentVersion: string): Promise<ConsentSnapshot> {
  consent = window.desktop
    ? await window.desktop.consentState()
    : { acceptedVersion: currentVersion, acceptedAt: null };
  return consent;
}
