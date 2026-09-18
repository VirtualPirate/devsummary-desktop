# Agent-CLI boundary checks

Manual. Each script drives the **compiled** backend (`apps/backend/dist`, so run
`pnpm build:backend` first) through the real `AgentCliLlmClient`, which spawns the real
`claude` / `opencode` / `agent` / `codex` binary on this machine. No mocks and no fixtures
— that is the point: these cover what a unit test against a recorded stdout cannot.

Each needs its CLI installed and logged in, spends real tokens, and writes its results as
JSON next to itself (gitignored). Every script's header states what it proves and how to
run it.

| Script | CLI |
|---|---|
| `claude-code.mjs` | `claude` |
| `opencode.mjs` | `opencode` |
| `cursor.mjs` | `agent` |
| `codex.mjs` | `codex` |
| `opencode-rate-limit.mjs` | `opencode` — what a throttled provider looks like from the app's side (~2 min by design) |

The UI half is `apps/desktop/test/agent-cli-*/`.
