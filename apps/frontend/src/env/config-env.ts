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
