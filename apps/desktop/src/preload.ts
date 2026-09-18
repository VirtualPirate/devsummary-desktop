import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { UpdateSnapshot } from './updater';

/**
 * The whole renderer surface. `apiConfig` resolves once the forked backend has
 * announced its OS-assigned port, so the frontend can await it before its first
 * request. Secrets are written renderer → backend (HTTP) → main (parent port);
 * they deliberately do not travel through here.
 */
contextBridge.exposeInMainWorld('desktop', {
  apiConfig: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke('api:config'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  openDataDir: (): Promise<string> => ipcRenderer.invoke('shell:open-data-dir'),
  consentState: (): Promise<{ acceptedVersion: string | null; acceptedAt: string | null }> =>
    ipcRenderer.invoke('consent:state'),
  acceptConsent: (termsVersion: string): Promise<void> =>
    ipcRenderer.invoke('consent:accept', termsVersion),
  quitApp: (): Promise<void> => ipcRenderer.invoke('consent:quit'),
  updateState: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:state'),
  checkUpdates: (): Promise<UpdateSnapshot> => ipcRenderer.invoke('updates:check'),
  setUpdatesEnabled: (enabled: boolean): Promise<UpdateSnapshot> =>
    ipcRenderer.invoke('updates:preference', enabled),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  /** Returns its own unsubscribe — contextBridge proxies returned functions. */
  onUpdatesChanged: (listener: (snapshot: UpdateSnapshot) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, snapshot: UpdateSnapshot): void => listener(snapshot);
    ipcRenderer.on('updates:changed', handler);
    return () => ipcRenderer.removeListener('updates:changed', handler);
  },
});
