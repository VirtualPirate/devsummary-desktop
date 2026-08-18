# Canvas — DevSummary design system

The visual language for the DevSummary web app. Canvas is **warm, human, and
calm**: it turns raw engineering activity into something a founder or PM can
read without feeling they've opened a developer tool. Soft rounded surfaces,
one confident accent, generous breathing room, and plain-English copy.

This file is the source of truth. When a screen and this document disagree, the
document wins — fix the screen. Precedence: the user's explicit request → this
document → component defaults.

---

## 1. Principles

1. **Lead with the story.** Plain-language headline and takeaway first;
   engineering detail (types, counts, SHAs) is supporting texture, never the
   lede.
2. **Warm and unintimidating.** A person who has never used a dashboard should
   feel invited in. Rounded surfaces, soft shadows, room to breathe.
3. **One accent, spent well.** Cornflower is the only brand color. Everything
   else is a chosen neutral or a semantic signal. Don't introduce new hues.
4. **State reads at a glance.** Encode status in shape and tint (chip, avatar,
   dashed border), not just words.
5. **Quiet by default.** Motion and decoration serve comprehension. If a
   flourish doesn't help someone understand or act, cut it.

---

## 2. Color

All color is CSS custom properties in `src/index.css` (oklch), themed for light
and dark. Never hard-code hex in components — reference tokens or Tailwind
utilities that map to them.

### Neutrals (the "canvas")
A calm, low-chroma neutral — a hair cool so it sits naturally with the
cornflower accent — never a dead flat grey. The system's warmth is emotional,
carried by soft elevation, rounded surfaces, pastel tags, and voice, not by a
sepia ground.

| Token | Role |
|-------|------|
| `--background` | app ground (warm near-white / warm charcoal) |
| `--card` | raised surface |
| `--muted` / `--muted-foreground` | quiet fills and secondary text |
| `--border` / `--border-strong` | hairlines and dividers |
| `--foreground` | primary text |

### Accent
| Token | Role |
|-------|------|
| `--brand` / `--brand-foreground` | the single accent — active state, selection, links, focus rings, key emphasis, brand mark |

Use the accent for **emphasis and state**, not as a background for large areas.
Selected/active surfaces use `bg-brand/12 text-brand`, never a full brand fill.

### Semantic — work types
Plain-English work categories keep a stable color everywhere they appear
(`--gb-chart-*`). Never repurpose these for decoration.

| Type (enum) | Reads as | Token |
|-------------|----------|-------|
| `feature` | New features | `--gb-chart-feature` |
| `fix` | Fixes | `--gb-chart-bug` |
| `optimization` | Speed-ups | `--gb-chart-optimization` |
| `refactor` | Cleanups | `--gb-chart-refactor` |
| `docs` | Doc updates | `--gb-chart-docs` |
| `test` | Tests | `--gb-chart-test` |
| `chore` | Chores | `--gb-chart-chore` |

Helpers live in `components/devsummary/shared/commit-type-colors.ts`
(`COMMIT_TYPE_CSS_VAR`, `COMMIT_TYPE_BG_CLASS`, `COMMIT_TYPE_TINT_CLASS`).

### Semantic — status
`--gb-status-shipped` (good / up), `--gb-status-at-risk` (attention),
`--gb-status-in-flight` (working), `--gb-status-on-hold` (paused),
`--destructive` (failure). Momentum "up" reuses `gb-status-shipped`.

---

## 3. Typography

Faces (loaded via `@fontsource-variable`): **Hanken Grotesk** (sans, also
headings) and **JetBrains Mono** (mono). `html` base is `18px`, so Tailwind
`text-sm` ≈ 15.75px.

| Role | Recipe |
|------|--------|
| Page title (h1) | `text-2xl sm:text-3xl font-semibold tracking-tight text-balance` |
| Section (h2) | `text-lg font-semibold tracking-tight` |
| Card / item title | `text-base font-semibold tracking-tight` (or `text-lg` for a hero) |
| Body | `text-sm leading-relaxed` (`text-[1.05rem] leading-relaxed` for long-form prose) |
| Standfirst / lede | `text-lg leading-relaxed text-muted-foreground` |
| Eyebrow / label | `font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground` |
| Numbers in columns | add `tabular-nums` |

Headlines get `text-balance`; keep running prose near 60–65ch (`max-w-[60ch]`).

---

## 4. Shape, elevation, spacing

**Radius** — the softness is deliberate.
- Controls (buttons, inputs, selects): `rounded-lg`
- Cards / surfaces: `rounded-2xl`
- Inner tiles / bars: `rounded-xl`
- Pills, chips, tags, segmented controls, avatar-pills: `rounded-full`

**Elevation** — a soft two-step system via theme tokens (color adapts per
theme). Applied through `<Card>` by default.
- `shadow-e1` — resting surface
- `shadow-e2` — hover / raised / dialogs

Avoid the old heavy single drop shadow. Never stack borders + strong shadow —
pick one primary separation per surface.

**Spacing rhythm**
- Page content: centered, `max-w-6xl`, `px-6 py-6` (set by the app shell).
- Between page sections: `mb-8` / `gap-8`.
- Card padding: `p-5` (compact) to `p-6`/`p-7` (feature/detail).
- Lists of cards: `flex flex-col gap-3`. Card grids: `grid gap-3` /
  `sm:grid-cols-2 lg:grid-cols-3`.
- Lay siblings out with `gap`, not per-child margins.

---

## 5. Motion

- Default transition `~150ms ease` on color, transform, shadow.
- **Interactive cards** lift: `transition hover:-translate-y-0.5 hover:shadow-e2`.
  Static containers don't lift.
- Loading: skeletons that mirror the final layout (`animate-pulse`), or a
  `Loader2` spinner tinted `text-brand` for short waits.
- Always honor `prefers-reduced-motion` (already globally respected — don't
  animate essential meaning).
- Visible keyboard focus everywhere: `focus-visible:outline-2
  focus-visible:outline-offset-2 focus-visible:outline-ring` (or the Button/Input
  built-ins).

---

## 6. Component recipes

Reach for the shared components first; only compose primitives when none fits.

**Surface card** — `<Card>` renders `rounded-2xl border bg-card shadow-e1`.
Use it for every panel. For a clickable card, wrap the content in a `<Link>`/
`<button>` and add `transition hover:-translate-y-0.5 hover:shadow-e2
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`.

**Entity identity** — a colored rounded-square avatar (entity initial) + name +
kind line. Projects/teams/collaborators/repositories and briefs all use it so a
scope is recognizable at a glance. See `ScopeIdentity` (briefs) and `EntityDot`
(`components/devsummary/shared`). New surfaces that show an entity should show
its avatar, not just a dot, when there's room.

**Tag / pill** — `rounded-full px-2.5 py-1 text-xs font-semibold`. Work-type
tags use `COMMIT_TYPE_TINT_CLASS` (soft tint fill + full-strength text) with a
leading color dot. Status pills use the status tokens.

**Segmented control** (filters, small toggles) —
`inline-flex gap-1 rounded-full border bg-card p-1 shadow-e1`; each option
`rounded-full px-3.5 py-1.5 text-xs font-medium`; active = `bg-brand/12
text-brand`, inactive = `text-muted-foreground hover:text-foreground`.

**Page header** — `PageHeader` (title + description + actions). Title is the h1
recipe; description is `text-sm text-muted-foreground`. Actions are right-aligned
buttons.

**Momentum chip** — derived signal (this period vs. recent average for the
scope). Up = `bg-gb-status-shipped/12 text-gb-status-shipped`; quieter/steady =
`bg-muted text-muted-foreground`. Hide when there's nothing to compare.

**Empty / error / loading** — use `EmptyState`, `ErrorState`, `SkeletonList` /
`SkeletonGrid`. Empty and error surfaces are `rounded-2xl border-dashed`; error
carries a `destructive` tint. Every empty state names one next action.

**Buttons** — via `<Button>`. `default` (ink) for the primary action on a
screen; `outline`/`secondary` for secondary; `ghost` for tertiary/toolbar;
`destructive` for removals. The accent is expressed through state/links, so
avoid a brand-filled button unless it's the singular hero CTA.

---

## 7. Voice

Words are design material — write from the reader's side of the screen.

- **Plain over precise-but-technical.** "Sign-in is more reliable," not
  "hardened the OAuth token refresh path." Name things people recognize.
- **Active voice, sentence case.** A control says what it does: "Generate now,"
  "Save changes," "Create project." The action keeps its name through the flow
  (button "Publish" → toast "Published").
- **Specific over clever.** "No briefs yet — generate one or set a schedule"
  beats "Nothing to see here."
- **Failure gives direction, not apology.** "We couldn't generate this brief —
  the summary timed out. Try again." No "Oops," no vague "Something went wrong."
- **Empty screens invite action.** State what this is and the one thing to do
  next.
- Numbers get plain units: "5 people," "34 commits," "40% faster."

---

## 8. Signature

What makes a screen unmistakably Canvas:

1. **Colored entity avatars** — every project/team/person/repo wears its color.
2. **Pastel work-type tags** — the plain-English translation of commit types.
3. **Soft-lifting cards** on a warm canvas — surfaces that respond gently to the
   pointer.
4. **A single cornflower accent** carrying all state and emphasis.

Spend boldness on the headline and the entity color; keep everything around them
quiet.
