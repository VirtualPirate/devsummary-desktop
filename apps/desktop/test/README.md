# Desktop checks

Two kinds live here.

**Automated** — no credentials, no network, safe in CI:

```bash
pnpm --filter desktop test:bundle   # test/bundle-shape.js — packaged bundle stays asar-packed
pnpm --filter desktop test:csp      # test/csp.js — renderer CSP and navigation locks
```

`test/drive.js` is the Electron entry point for the IPC/preload checks and runs under
`FAKE_BACKEND_MODE=happy|crash electron test/drive.js`, against `test/fake-backend.js`.

**Manual** — each one drives the real app and needs something the machine has to supply
(a built dmg, Docker, a GitHub PAT, a logged-in agent CLI). None is wired to `pnpm test`
on purpose. Every script's header states what it proves and how to run it; each writes its
results as JSON next to itself, and those outputs are gitignored.

| Path | Needs | Proves |
|---|---|---|
| `platform/launch-dmg.mjs` | a built dmg | Install + first launch per mac arch, and whether the bundle went through Rosetta |
| `platform/run-appimage.sh` + `check-linux.mjs` | Docker | The AppImage boots on a clean, keyring-less Debian under Xvfb |
| `first-run/driver.mjs` | a built shell | Empty state with no PAT and no LLM key — a setup path, not a wall of failed jobs |
| `packaged-upgrade/driver.mjs` | two built dmgs | Data survives a packaged upgrade, behind the migration backup |
| `e2e-live/driver.mjs` | dev shell + Vite | 12 UI steps through the real app against mocked externals |
| `e2e-real/driver.mjs` | a real GitHub PAT | Connect → ingest → analyze → generate → deliver, unmocked |
| `agent-cli-claude-code/driver.mjs`, `agent-cli-opencode/driver.mjs` | that CLI installed and logged in | The provider card detects, versions and tests a real agent CLI |

The compiled-backend half of the agent-CLI work is `apps/backend/test/agent-cli/`.
