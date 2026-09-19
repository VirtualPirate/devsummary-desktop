import { useCallback, useEffect, useState } from "react";

import type { UpdateSnapshot } from "@/env/config-env";

/**
 * Seeds from the main process and then follows its pushes. Two consumers
 * (the banner and the Settings card) each hold their own subscription — no
 * context and no store, because the shared state is one small object that main
 * already owns and re-sends on every transition.
 *
 * Headless (a bare `vite dev`, no `window.desktop`) reports updates off, which
 * renders nothing and disables the card.
 */
const HEADLESS: UpdateSnapshot = {
  state: { status: "idle" },
  currentVersion: "",
  enabled: false,
  canInstall: false,
};

export function useAppUpdates() {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>(HEADLESS);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let live = true;
    void desktop.updateState().then((next) => {
      if (live) setSnapshot(next);
    });
    const off = desktop.onUpdatesChanged(setSnapshot);
    return () => {
      live = false;
      off();
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    const result = await window.desktop?.setUpdatesEnabled(next);
    if (result) setSnapshot(result);
  }, []);

  const checkNow = useCallback(async () => {
    const result = await window.desktop?.checkUpdates();
    if (result) setSnapshot(result);
  }, []);

  const install = useCallback(() => window.desktop?.installUpdate(), []);

  return { ...snapshot, setEnabled, checkNow, install };
}
