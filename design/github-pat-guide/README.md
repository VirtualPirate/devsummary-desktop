# GitHub PAT setup guide — design record

**Approved:** v1, variant A — the annotated screenshot sits beside the paste field on the connect
screen, so the three settings a user must choose on GitHub are visible while they are choosing them.
No click, no dialog. On the already-connected page the same picture is collapsed behind a
disclosure, because that user has done this once already.

## Stack (detected)

| Concern | Fact | Evidence |
|---|---|---|
| Framework | React 19 + TypeScript strict, function components | `apps/frontend/package.json`, `src/routes/integrations-github.tsx` |
| Routing | TanStack Router, code-based, one page component per route | `src/router.tsx`, route files export `<Name>Page` |
| Styling | Tailwind CSS v4, no config file; tokens are oklch CSS vars | `src/index.css` (`@theme inline` block) |
| Components | shadcn/ui primitives in `src/components/ui/`; feature components compose them | `src/components/integrations/*` |
| Icons | `lucide-react` | `import { AlertTriangle } from "lucide-react"` in the route |
| Class merging | `cn()` from `@/lib/utils` | used throughout `src/components` |
| Expand/collapse idiom **in this folder** | plain `useState` + `aria-expanded` + `ChevronDown`/`ChevronRight`, **not** Radix `Collapsible` | `src/components/integrations/installation-row.tsx:53,68,71` |
| Image asset | `apps/frontend/src/assets/github-pat-setup.png` (995×798), **imported**, never `/public` | Vite `base: "./"` + Electron `win.loadFile(...)` (`apps/desktop/src/main.ts:331`) — an absolute `/foo.png` 404s under `file://` |
| CSP | `img-src 'self' file: data:` already allows a bundled image | `apps/frontend/vite.config.ts` |

## Implementation mapping

| Demo block | Target file | Action |
|---|---|---|
| `[data-variant="a"] .ds-plate` (plate chrome + image + caption) and `.ds-fallback` | `apps/frontend/src/components/integrations/github-setup-guide.tsx` | create |
| `[data-variant="a"] .screen:nth-of-type(1)` — connect empty state, `.ds-split` two-column with left-aligned hero | `apps/frontend/src/routes/integrations-github.tsx` (the `installations.length === 0` branch) | modify |
| `[data-variant="a"] .screen:nth-of-type(2)` — "Replace token" card with the guide behind a disclosure | `apps/frontend/src/routes/integrations-github.tsx` (the `Replace token` `<Card>`) | modify |

### Details the demo fixes

- **Layout.** Empty state becomes a grid: `grid gap-7 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-9`,
  items start-aligned, wrapper widened from `max-w-*` centring to a wide container. Below `lg` the
  picture stacks under the form at full width. The hero (GitHub mark, `Connect GitHub`, lede, form)
  keeps its current markup but is left-aligned inside the left column instead of centred.
- **The plate.** The screenshot is dark-mode GitHub, so on the light theme it must read as an
  embedded window, not a broken block: a bordered container (`border-border-strong`, `rounded-xl`,
  `overflow-hidden`), a top bar with three dots and the source URL
  `github.com/settings/personal-access-tokens/new` in mono, the image, then a caption strip
  `1 No expiration · 2 Only select repositories · 3 Contents: Read-only`.
  **New, flagged:** the plate's greys are GitHub's own chrome colours, not project tokens —
  `#0d1117` (body), `#161b22` (bars), `#262d38` (hairlines), `#8b949e` / `#c9d1d9` (bar text).
  Hardcode them as Tailwind arbitrary values inside this one component, with a comment saying they
  belong to the screenshot, not to the theme. They must not change with `.dark`.
- **Heading above the plate:** `What to select on GitHub`.
- **Alt text and fallback carry the same three lines** (`onError` swaps the image for a dashed-border
  text block): `Expiration: No expiration` / `Repository access: Only select repositories, then pick
  the repos to summarize` / `Permissions: add Contents → Read-only. Metadata is added by GitHub.`
- **Replace-token card:** a text-button disclosure labelled `What to select on GitHub` with a chevron,
  `useState` + `aria-expanded`, rendering the same component collapsed by default.

## Out of scope

- `GITHUB_PAT_PERMISSIONS` in `packages/api-interfaces` — the prose permission list stays exactly as
  it is today, and no "expiration" entry is added to it.
- `routes/integrations-github-setup.tsx` (branch selection), Slack and AI integration pages.
- `github-pat-form.tsx` internals — the form is reused unchanged; only its surroundings move.
- Re-shooting or re-annotating the screenshot.

## Variants considered

- **B — dialog behind a "Show me where" link.** Smallest diff, page shape untouched — rejected: a
  user in a hurry pastes a 30-day token and never opens it, which is the failure this exists to stop.
- **C — three numbered steps, each beside a CSS crop of the screenshot.** Highest hit rate and lets
  errors point at a step number — rejected for now: the crops are hardcoded pixel offsets into the
  PNG, so every re-shoot means re-measuring three background positions.
