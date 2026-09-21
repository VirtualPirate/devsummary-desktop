# GitHub PAT permissions — design record

**Approved:** v1, variant C — the filled box holds only the two *required* grants (Contents,
Metadata) as scannable rows; Members is a single muted footnote line under the box, not a third row.
The 99% path does not compete with an org-only option.

## Stack (detected)

| Concern | Fact | Evidence |
|---|---|---|
| Framework | React 19 + TypeScript strict, function components | `apps/frontend/package.json` |
| Styling | Tailwind CSS v4, no config file; oklch CSS vars | `apps/frontend/src/index.css` (`@theme inline`) |
| Components | shadcn/ui primitives in `src/components/ui/`; feature components compose them | `src/components/integrations/github-pat-form.tsx` |
| Badge | `Badge` with `variant="secondary" \| "outline"` exists already | `src/components/ui/badge.tsx` |
| Icons | `lucide-react` | `import { ExternalLink } from "lucide-react"` in the form |
| Class merging | `cn()` from `@/lib/utils` | used throughout `src/components` |
| Permission source of truth | `GITHUB_PAT_PERMISSIONS` in `packages/api-interfaces/src/requests/github.requests.ts`; **one consumer only** — the form | `grep GITHUB_PAT_PERMISSIONS` → only `github-pat-form.tsx` |
| Shared package build | frontend consumes built `dist/`, so a package edit needs `pnpm build:packages` | root `AGENTS.md`, `apps/frontend/AGENTS.md` |
| Error surfacing today | `toast.error(extractErrorMessage(err))` in the form's `catch` | `github-pat-form.tsx` |
| Server error copy | `GitHub rejected this token (GET /user). Check it has not expired and grants Contents: Read-only and Metadata: Read-only…` | `apps/backend/src/integrations/github/services/installations.service.ts:236` |

## Implementation mapping

| Demo block | Target file | Action |
|---|---|---|
| `[data-variant="c"] .perm-c` — `.perm-c-box` rows + `.perm-c-foot` footnote | `apps/frontend/src/components/integrations/github-pat-form.tsx` (replaces the current `<ul className="space-y-1.5 rounded-xl border bg-muted/40 …">`) | modify |
| `[data-variant="c"] .perm-dense` — same list, tighter rows (screen 4, inside the Replace-token Card) | same file — a `dense` prop on `GithubPatForm` | modify |
| `[data-variant="c"] .ds-callout` — inline token error above the list (screen 3) | same file | modify |
| Short row/footnote copy shown in the demo | `packages/api-interfaces/src/requests/github.requests.ts` (`GITHUB_PAT_PERMISSIONS[].reason`) | modify |

### Details the demo fixes

- **Row shape.** `Contents` / `Metadata`, each: name (13px, medium) then a wrapping side group —
  mono `Read-only` chip (`Badge variant="outline"`, `font-mono text-[11px] border-border-strong`),
  a `required` badge (`Badge variant="secondary"`), then the reason in muted 12px that flexes and
  wraps last. Box: `rounded-xl border bg-muted/40`, rows separated by a top border, `min-w-0` and
  `overflow-wrap: break-word` so nothing overflows at a 390px column.
- **Footnote.** Optional permissions render as one muted 12px line **under** the box, never inside
  the fill and never a row: `Members (optional) — Org collaborators.`
- **Required vs optional comes from the data**, not a hardcoded list: `required: true` entries are
  rows in the box, `required: false` entries are footnote lines.
- **Row name is the short GitHub name.** The constant keeps its full
  `Repository permissions → Contents` string (it says where to look on GitHub); the row prints the
  segment after `→`. Do not add a second name field for this.
- **Copy** (the constant's `reason` strings shorten to the demo's, since the form is the only
  consumer): Contents → `Commits and diffs.`; Metadata → `Added by GitHub.`;
  Members → `Org collaborators.` The `permission`, `access` and `required` fields are unchanged —
  they mirror what the backend validates.
- **Dense variant.** Rows `px-2.5 py-1.5` instead of `px-3 py-2`, footnote margin tightened. Used
  only by the Replace-token Card (`<GithubPatForm onConnected="stay" dense />`).
- **Inline error.** The demo's error screen keeps the list on the page as the diagnosis and puts the
  message in a callout above it: `flex gap-2.5 rounded-xl border border-gb-status-at-risk/35
  bg-gb-status-at-risk/10 px-3.5 py-3 text-sm`, with an `AlertTriangle` in
  `text-gb-status-at-risk` — the same treatment as the unconfigured-repos banner in
  `routes/integrations-github.tsx`. Hold the message in local state, clear it on resubmit, and
  render **the server's message** (`extractErrorMessage(err)`) — the demo's string is one plausible
  instance of that message, not new backend copy. Replace the `toast.error` call; success still
  toasts.

## Out of scope

- The screenshot plate (`github-setup-guide.tsx`) and the two-column empty state — already shipped;
  demo screens 1 and 4 include them only as surroundings.
- Backend error classification. No new API error codes, no per-permission diagnosis; the callout
  shows whatever `POST /api/integrations/github/token` returned.
- `routes/integrations-github.tsx` apart from passing `dense` to the Replace-token form.
- Slack and AI integration pages, `integrations-github-setup.tsx`.

## Variants considered

- **A — three equal spec rows.** Members is a full spec row like Contents — rejected: an optional,
  org-only grant reads as a fourth thing to go do, on the screen whose whole job is the required path.
- **B — grouped like GitHub's token page** (Repository permissions box + unfilled Organization
  permissions heading). Strongest mapping to what the user is looking at — rejected: two headings
  plus a box is a lot of structure for three lines, and it doubles in height inside the Card.

## Verify

```bash
pnpm build:packages && cd apps/frontend && pnpm build && pnpm lint
```
