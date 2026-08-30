# UI Redesign — "Karta / bistro" Implementation Plan

## Overview

Replace the dark "cosmic" glassmorphism theme with a light, warm "Karta / bistro"
theme: porcelain canvas, ink text, bottle green brand, amber accent used
sparingly. The signature element is a menu row rendered like a printed menu line
— item name, dotted leader, tabular price.

The design direction was locked in `change.md` and is not re-litigated here.
This plan is about how to land it across 32 files without breaking anything.

## Current State Analysis

**The token layer already exists and is already light.** `src/styles/global.css`
declares the full 30-token shadcn set in `oklch` on `:root` (lines 6-39), with a
`.dark` override block (41-73) and an `@theme inline` mapping (75-111) that
generates `bg-background`, `text-foreground` and friends. Because the theme
block is `inline`, the generated utilities emit `var(--background)` directly —
changing the `:root` values is enough, nothing needs regenerating.

**Almost nothing uses it.** `src/layouts/Layout.astro:18` hardcodes
`class="dark"` on `<html>`, and the rest of the app paints itself with literal
Tailwind palette classes on top of a custom `bg-cosmic` gradient.

Measured surface (all counts are `src/`-only, matching lines):

| Pattern | Lines | Files |
|---|---|---|
| `text-white*` | 61 | 26 |
| `bg-white/*` | 35 | 20 |
| `border-white/*` | 35 | 21 |
| `text-blue-100/*` | 20 | 12 |
| `bg-cosmic` | 11 | 11 (1 definition + 9 real call sites) |
| `backdrop-blur` | 9 | 7 |
| `from-blue-` / `to-purple-` | 10 / 9 | 9 / 8 |
| `dark:` | 11 | 6 — **all inside `src/components/ui/`** |

**32 of 45 `.astro`/`.tsx` files need edits; ~197 class-bearing lines. 13 files
are already clean.**

Key structural facts discovered:

- All 9 real shadcn primitives are 100% token-driven. `dark:` appears only
  inside `src/components/ui/`, nowhere else. Retheming them costs **zero
  component edits**.
- `bg-cosmic` is a real custom utility (`global.css:113-115`) expanding to a
  three-stop hardcoded hex gradient. Not a token, no light counterpart.
- There is **no web font at all** — no `@fontsource*` dependency, no
  `@font-face`, no `--font-*` token, nothing in `public/`. The current stack is
  Tailwind's Preflight default.
- There is no `prefers-color-scheme` handling, no theme toggle, no persistence,
  and no `color-scheme` declaration anywhere.
- **Zero test risk.** No test asserts on classes or DOM; there is no DOM
  environment configured in either vitest project, so no component test could
  exist even in principle.
- `src/components/ui/LibBadge.astro` is hardcoded, non-shadcn, and has **zero
  importers** — dead code.
- `src/components/Banner.astro` is already light (literal hex in a scoped
  `<style>`) and renders above the `bg-cosmic` wrapper. It is the one light
  element in a dark app today.

## Desired End State

Every screen renders on a porcelain canvas with ink text, bottle-green brand
accents and white cards separated by warm hairlines. Headings are set in
Bricolage Grotesque, self-hosted. The menu list reads like a printed menu:
`Pierogi ruskie ·········· 24,50 zł`, with availability and allergen chips
beside it. Nothing anywhere renders white-on-cream.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run test`,
`npm run test:integration` and `npm run build` all pass, and the manual
walkthrough in Testing Strategy finds no unreadable text, no invisible border
and no lost focus ring on any screen.

### Key Discoveries:

- **The eight gradient-clipped headings are the one genuinely dangerous
  pattern.** `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text
  text-transparent` appears identically at `dashboard.astro:12`,
  `settings.astro:32`, `staff.astro:25`, `menu.astro:16`, `room.astro:14`,
  `auth/signin.astro:12`, `auth/signup.astro:12`, `auth/confirm-email.astro:27`,
  plus a three-stop variant at `Welcome.astro:33`. On a cream background,
  200-weight stops are near-white — the headings do not merely look wrong, they
  **disappear**.
- **Five class maps encode meaning, not decoration**, and all five are tuned for
  a dark background: availability (`MenuItemRow.tsx:15-19`), staff role
  (`StaffRow.tsx:7-11`), table active/inactive (`DraggableTable.tsx:33-34`), room
  tab selected (`RoomTabs.tsx:39-40`), table list row (`TableList.tsx:23-28`).
  Their labels come from `src/types.ts`, so meaning survives in text — but the
  colour is the at-a-glance signal.
- **The glass recipe is always the same two classes**: `border border-white/10
  bg-white/5` for rows and panels, `border-white/10 bg-white/10` for auth cards.
  A mechanical substitution, not 35 individual decisions.
- **Three auth pages are byte-identical** in their wrapper markup, and three
  managers repeat the same error/loading/empty triad. 27 of the ~197 hits live
  in duplicated code.
- Two hardcoded input recipes (`auth/FormField.tsx:6`, `settings.astro:25-26`)
  duplicate what token-driven `ui/input.tsx` already does.
- `prettier-plugin-tailwindcss` reorders class strings on every touched file.
  Expect large but semantically empty diffs.

## What We're NOT Doing

- **No dark mode.** The `.dark` block and `class="dark"` are removed outright,
  not retuned. There is no toggle, no `prefers-color-scheme` handling and no
  persistence today, so a second theme would be untested dead code.
- **No new dependencies beyond the font.** `@fontsource-variable/bricolage-grotesque`
  is the only addition.
- **No component library swap, no layout changes, no new screens.** This is a
  restyle: same markup structure, same components, same routes.
- **No accessibility automation.** No axe, no Lighthouse gate, no DOM test
  environment — that would be building test infrastructure under cover of a
  restyle. Contrast is verified by checklist.
- **No tabular figures outside the menu row.** Table numbers and other amounts
  keep the default stack.
- **No copy changes** except `Welcome.astro`, which is rewritten.
- **No touching `Banner.astro`'s literal hex** beyond re-toning to warm values if
  it clashes; its scoped-style approach stays.

## Implementation Approach

Layer by layer, not screen by screen: each phase makes one kind of change
everywhere, so the same decision is never made twice in different files.

The token layer goes first because it is load-bearing for everything after it —
once `:root` carries bistro values and `class="dark"` is gone, all nine shadcn
primitives are correct with zero edits, and later phases have a stable
vocabulary to substitute into.

Named tokens and shadcn tokens are **both** defined, with the shadcn set
aliasing the named set. This is what keeps the free primitive retheme while
still making the palette legible in code:

```css
@theme {
  --color-porcelain: oklch(…);
  --color-bottle:    oklch(…);
}
:root {
  --background: var(--color-porcelain);
  --primary:    var(--color-bottle);
}
```

Three shared components (`AuthCard`, `ErrorPanel`, `EmptyState`) are extracted
along the way, each in the phase that touches its surface. They are extracted
because the duplicated blocks are identical character-for-character, not merely
similar.

## Critical Implementation Details

**Expect the app to look worse between phases 1 and 4.** After the token phase,
shadcn primitives are correct but every feature component is still painted for a
dark background — white text and white scrims on porcelain. This is inherent to
a layer-by-layer split. Do not evaluate the visual result before phase 4 is
complete, and do not "fix" intermediate ugliness ad hoc; the later phases own it.

**Commit the refactor separately from the restyle within each phase.** Phases 2
and 3 extract shared components while also changing colours. A single commit
mixing "moved this markup" with "changed these classes" is very hard to review,
and `prettier-plugin-tailwindcss` reordering makes it worse. Extract first,
restyle second.

**Run `npm run format` before requesting review on any phase.** The Tailwind
prettier plugin sorts class strings, so an unformatted diff shows reordering
noise indistinguishable from real changes.

## Phase 1: Token layer, font and dark-mode removal

### Overview

Establish the vocabulary the rest of the plan substitutes into, and cash in the
free shadcn retheme.

### Changes Required:

#### 1. Theme tokens

**File**: `src/styles/global.css`

**Intent**: Define the bistro palette as named tokens, alias the shadcn token
set onto it, add semantic tokens for the five class maps, add a display font
token, and replace the cosmic gradient utility.

**Contract**: In `@theme`, add named colours (porcelain canvas, ink text, bottle
green brand, amber accent, warm hairline, white card) and `--font-display`. In
`:root`, repoint the existing 30 shadcn tokens at the named ones rather than
holding literal values. Add semantic triples — fill, foreground and border for
success, warning, info and neutral — since five maps × three states is fifteen
contrast decisions that must be made once, centrally, not scattered.

Delete the entire `.dark` block and the `@custom-variant dark` line. Replace the
`@utility bg-cosmic` body with the porcelain canvas, keeping the utility name so
the nine call sites in phase 2 can be substituted mechanically rather than
hunted.

Record the computed contrast ratio for each foreground/background token pair in
a comment beside it. That is the single highest-leverage verification in this
plan: get the tokens right and everything downstream inherits it.

#### 2. Document shell

**File**: `src/layouts/Layout.astro`

**Intent**: Stop forcing dark mode, declare the colour scheme, and load the
display font.

**Contract**: Remove `class="dark"` from `<html>` (line 18) and the comment above
it explaining why Radix portals needed it — that reason evaporates with the
`.dark` block. Add `color-scheme: light` so native scrollbars, autofill and date
pickers stop rendering dark-on-light. Import the variable font.

#### 3. Font dependency

**File**: `package.json`

**Intent**: Self-host Bricolage Grotesque rather than calling a third-party CDN.

**Contract**: Add `@fontsource-variable/bricolage-grotesque`. The variable build
is one file covering every weight, which matters on Workers where every asset is
served from the same origin.

#### 4. Dead code

**File**: `src/components/ui/LibBadge.astro`

**Intent**: Delete rather than restyle.

**Contract**: Hardcoded, not a shadcn primitive, zero importers repo-wide.
Removing it is one fewer file in every later phase's grep.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Production build succeeds: `npm run build`
- No `dark:` utility remains outside `src/components/ui/`: grep returns only `ui/` hits

#### Manual Verification:

- Every shadcn primitive renders light without any component edit — open a dialog, a select and a form on any screen
- Bricolage Grotesque actually loads (visible in devtools Network, and headings render in it once phase 2 applies the token)
- Native scrollbars and autofill render light
- Recorded contrast ratios in `global.css` all meet AA for their intended use

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase. The app will
look broken at this point — that is expected and is not a reason to stop.

---

## Phase 2: Page shells and headings

### Overview

Swap the nine page shells onto the porcelain canvas and replace the eight
gradient-clipped headings — the one pattern that fails invisibly.

### Changes Required:

#### 1. Shared auth card

**File**: `src/components/auth/AuthCard.astro`

**Intent**: Collapse three byte-identical wrappers into one.

**Contract**: Takes a title and a slot. Absorbs the shell and card markup
currently repeated verbatim in `auth/signin.astro`, `auth/signup.astro` and
`auth/confirm-email.astro` — 15 of the ~197 hits live in those three copies.
Commit the extraction before the restyle, so the review can see that the markup
moved unchanged.

#### 2. Auth pages

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`,
`src/pages/auth/confirm-email.astro`

**Intent**: Consume `AuthCard`.

**Contract**: Each page keeps its frontmatter (the `error` query param read) and
its island; the wrapper markup goes.

#### 3. Remaining page shells

**Files**: `src/pages/dashboard.astro`, `settings.astro`, `staff.astro`,
`menu.astro`, `room.astro`

**Intent**: Move each shell onto the porcelain canvas.

**Contract**: `bg-cosmic` now expands to the canvas, so the class name can stay
where it reads as "the page background" or be replaced with `bg-background`.
Pick one and apply it consistently across all nine sites.

#### 4. Headings

**Files**: the eight pages above plus `src/components/Welcome.astro`

**Intent**: Replace the gradient-clip heading idiom with a flat brand colour set
in the display face.

**Contract**: `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text
text-transparent` → bottle-green text in `--font-display`. Same size and weight
scale. `Welcome.astro`'s three-stop variant is handled in phase 5 when that file
is rewritten, but must not be left as transparent text in the meantime — give it
the flat treatment now even though the file is rewritten later.

The `text-transparent` is the dangerous part: if the gradient is removed but
`text-transparent` survives anywhere, that heading is invisible with no error.
Grep for `text-transparent` at the end of this phase and expect zero hits.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Production build succeeds: `npm run build`
- No `text-transparent` remains in `src/`: grep returns zero hits
- No `bg-clip-text` remains in `src/`: grep returns zero hits

#### Manual Verification:

- Every page heading is visible and legible — `/`, `/dashboard`, `/settings`, `/staff`, `/menu`, `/room`, `/auth/signin`, `/auth/signup`
- The three auth pages render identically to each other after the `AuthCard` extraction
- Headings render in Bricolage Grotesque, not the fallback stack

**Implementation Note**: Pause for manual confirmation before phase 3.

---

## Phase 3: Surfaces

### Overview

Turn the glass scrims into real cards. This is the largest mechanical phase and
the one where duplicated status markup gets consolidated.

### Changes Required:

#### 1. Shared status components

**Files**: `src/components/ui/ErrorPanel.tsx`, `src/components/ui/EmptyState.tsx`

**Intent**: Replace six copies of the error panel and three of the dashed empty
state with one component each.

**Contract**: `ErrorPanel` takes a message and an optional retry action —
current copies live at `MenuManager.tsx:50,230`, `StaffManager.tsx:38,103`,
`RoomLayoutManager.tsx:56,250`. `EmptyState` takes a message and an optional
action — `MenuManager.tsx:236-237`, `StaffManager.tsx:111-112`,
`RoomLayoutManager.tsx:256-257,274-275`. Extract first, restyle second, in
separate commits.

#### 2. Card and panel surfaces

**Files**: `src/components/menu/{MenuItemRow,CategorySection,MenuManager,MenuItemDialog}.tsx`,
`src/components/staff/{StaffRow,StaffManager,StaffDialog}.tsx`,
`src/components/room/{RoomLayoutManager,RoomTabs,TableList,RoomCanvas,DraggableTable}.tsx`,
`src/components/Topbar.astro`, `src/pages/{dashboard,settings,staff}.astro`

**Intent**: Replace the glass recipe with real card surfaces.

**Contract**: `border border-white/10 bg-white/5` → card background with a warm
hairline border and soft shadow. Remove all nine `backdrop-blur-xl`. The
substitution is uniform; treat any site that does not fit the pattern as a
finding worth flagging rather than improvising.

#### 3. Input recipe dedupe

**Files**: `src/components/auth/FormField.tsx`, `src/pages/settings.astro`

**Intent**: Stop maintaining two hand-rolled input styles that duplicate a
token-driven component.

**Contract**: `FormField.tsx:6`'s `inputBase` and `settings.astro:25-26`'s
`inputClass` both reimplement `ui/input.tsx`. Replace with `<Input />`, keeping
`FormField`'s icon, error and hint composition. Removes six hits for free and
means future input changes happen in one place.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration`
- Production build succeeds: `npm run build`
- No `backdrop-blur` remains in `src/`: grep returns zero hits
- No `bg-white/` or `border-white/` remains in `src/`: grep returns zero hits

#### Manual Verification:

- Card boundaries are visible on every list and panel — menu, staff roster, room layout, settings
- Dashed empty states are visible; the room canvas and orphan-tables panel are distinguishable from the page background
- Every form input looks and behaves the same after the `<Input />` swap, including error and focus states
- Dialogs and selects still render correctly over the new surfaces

**Implementation Note**: Pause for manual confirmation before phase 4.

---

## Phase 4: Text tiers and semantic maps

### Overview

The phase that makes the app readable. Until this lands, most text is white on
porcelain.

### Changes Required:

#### 1. Text tiers

**Files**: all 24 non-`ui/` files carrying `text-white*` or `text-blue-100/*`

**Intent**: Map two ad-hoc opacity scales onto the two token tiers.

**Contract**: `text-white` → `text-foreground`. `text-white/40` through `/80`
and every `text-blue-100/*` → `text-muted-foreground` — these are the muted tier,
not the primary tier at reduced opacity, and treating them as the latter
produces washed-out text. Leave `text-white` inside `ui/button.tsx:14` and
`ui/badge.tsx:15` alone: white on saturated red is correct in both themes.

#### 2. Inverted hover states

**Files**: `src/components/Topbar.astro`, `src/pages/{settings,staff,menu,room}.astro`

**Intent**: Fix links whose hover makes them less visible.

**Contract**: `text-purple-300 hover:text-purple-100` goes lighter on hover,
which inverts on a light background. Hover must darken or otherwise increase
contrast. Eight sites.

#### 3. Semantic class maps

**Files**: `src/components/menu/MenuItemRow.tsx`,
`src/components/staff/StaffRow.tsx`,
`src/components/room/{DraggableTable,RoomTabs,TableList}.tsx`

**Intent**: Repoint the five meaning-bearing maps at the semantic tokens defined
in phase 1.

**Contract**: Availability (available / unavailable / sold_out), staff role
(owner / waiter / kitchen), table active / inactive, room tab selected /
unselected, table list row. Each state uses a fill/foreground/border triple from
the semantic tokens rather than a hand-picked palette number.

Two things must survive: the `border-dashed` on an inactive table, which carries
meaning independently of colour, and the shape classes in
`DraggableTable.tsx:31` (`rounded-full` vs `rounded-lg`), which are geometry and
theme-independent. Keep the existing bracketed multi-line `cn()` form — the
project's lint convention prefers brackets over one-liners.

#### 4. Dark-tuned status tints

**Files**: `src/components/auth/ServerError.tsx`,
`src/components/room/RoomLayoutManager.tsx`, `src/pages/settings.astro`, plus
the destructive icon-button hovers

**Intent**: Retone tints that were designed against a dark background.

**Contract**: `ServerError.tsx:11`'s `bg-red-900/30` is unambiguously a
dark-mode fill. `RoomLayoutManager.tsx:297`'s `border-amber-400/30
bg-amber-500/5` orphan-tables panel is 5% amber — indistinguishable from cream.
`settings.astro:40,42` success and error banners use `text-*-100`. Inline
validation `text-red-400` should become `text-destructive`. Destructive icon
hovers (`hover:text-red-300` at `MenuItemRow.tsx:103`, `CategorySection.tsx:90`,
`MenuItemDialog.tsx:219`, `StaffRow.tsx:73`) need the same darkening treatment as
the links above.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration`
- Production build succeeds: `npm run build`
- No `text-white` remains outside `src/components/ui/`: grep returns only the two `ui/` destructive hits
- No `text-blue-100` remains in `src/`: grep returns zero hits

#### Manual Verification:

- Every screen is readable end to end; no white-on-cream anywhere
- All three availability states are distinguishable at a glance on `/menu`
- All three role states plus the inactive badge are distinguishable on `/staff`
- Active and inactive tables are distinguishable on `/room`, and the dashed border survives on inactive
- Every link and destructive icon gains contrast on hover, never loses it
- Error and success banners are legible — trigger a failed sign-in and a settings save
- Keyboard focus rings are visible on every interactive element
- All `aria-label`s survived the edits (they are not test-guarded)

**Implementation Note**: Pause for manual confirmation before phase 5.

---

## Phase 5: Landing page and the signature menu row

### Overview

The two pieces that carry identity rather than mechanics.

### Changes Required:

#### 1. Landing page

**File**: `src/components/Welcome.astro`

**Intent**: Rewrite rather than restyle.

**Contract**: This is still starter-template copy ("A production-ready starter
with authentication…") on the product's front door, and its three blurred
"cosmic orbs" (`:8`, `:12`, `:16`) would become muddy smears on cream rather than
merely wrong. Replace with a bistro-themed hero and section content describing
OrderLY. Delete the orbs outright. `Topbar.astro` is imported here and stays.

#### 2. Signature menu row

**File**: `src/components/menu/MenuItemRow.tsx`

**Intent**: Deliver the one memorable element the design direction is built
around.

**Contract**: Render the row as a printed-menu line — item name, dotted leader
filling the space, price right-aligned in tabular figures
(`font-variant-numeric: tabular-nums`). The existing availability and allergen
chips stay beside it. The leader must degrade gracefully when the name is long
enough to wrap and must not be announced by screen readers.

Confined to this component by decision: the design direction calls for one
signature element with everything else quiet, and tabular figures elsewhere were
explicitly deferred.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Unit tests pass: `npm run test`
- Integration tests pass: `npm run test:integration`
- Production build succeeds: `npm run build`
- No `bg-cosmic` call sites remain if the utility was retired: grep matches the chosen convention from phase 2

#### Manual Verification:

- The landing page describes OrderLY, not the starter template
- No blurred orbs remain; the page reads as warm and light
- The menu row reads as a printed menu line, with prices aligned in a column
- The dotted leader behaves at narrow widths and with long item names
- A screen reader announces name and price without reading the leader
- The whole app is walked once more at mobile width

**Implementation Note**: Pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

No new unit tests. Nothing in this change is logic — the existing suites
(geometry, identity, four zod schemas) are unaffected and serve as regression
guards that the restyle did not touch behaviour.

### Integration Tests:

The `tests/integration/` suites (authz, isolation, smoke) assert on HTTP status
and RLS, never on markup. They must stay green through every phase; a failure
means something non-visual was changed by accident.

### Manual Testing Steps:

Contrast and visual correctness cannot be verified by any automated check in
this project — there is no DOM environment configured — so the checklist is the
verification.

1. Walk every route as an owner: `/`, `/dashboard`, `/menu`, `/room`, `/staff`, `/settings`.
2. Walk `/dashboard` as a waiter and as kitchen — role-gated nav differs.
3. Sign-in, sign-up and an intentionally failed sign-in, checking the error banner.
4. Open every dialog: menu item, category, staff, room, table, plus an alert-dialog confirm.
5. Trigger each status state: loading, error with retry, empty.
6. Tab through each screen and confirm the focus ring is visible on every control.
7. Check each of the five semantic maps in both directions (e.g. toggle a table active/inactive).
8. Repeat at mobile width.
9. Check `prefers-reduced-motion` still suppresses transitions.

## Performance Considerations

One new asset: the variable font. Self-hosting keeps it on the same origin as
everything else, so there is no extra DNS lookup or connection setup, and the
variable build is a single file for all weights. Removing nine `backdrop-blur-xl`
layers is a small win — backdrop filters are among the more expensive paint
operations, particularly on the low-end tablets a restaurant is likely to use.

## Migration Notes

No data, no schema, no API surface. Purely presentational, and reverting is a
`git revert` of the phase commits with no cleanup.

One coordination note: this branch touches `src/pages/dashboard.astro` and
`src/layouts/Layout.astro`, both of which have been shared append-only files
across parallel slices. Check for in-flight branches touching them before
starting each phase.

## References

- Change notes and locked design direction: `context/changes/ui-redesign/change.md`
- Theme layer: `src/styles/global.css:6-115`
- Dark-mode switch: `src/layouts/Layout.astro:14-18`
- The dangerous heading idiom: `src/pages/dashboard.astro:12` (and seven siblings)
- Semantic maps: `src/components/menu/MenuItemRow.tsx:15-19`, `src/components/staff/StaffRow.tsx:7-11`, `src/components/room/DraggableTable.tsx:33-34`, `src/components/room/RoomTabs.tsx:39-40`, `src/components/room/TableList.tsx:23-28`
- Duplicated input recipes: `src/components/auth/FormField.tsx:6`, `src/pages/settings.astro:25-26`
- Labels that carry meaning in text: `src/types.ts` (`AVAILABILITY_LABELS`, `STAFF_ROLE_LABELS`, `TABLE_SHAPE_LABELS`, `ALLERGEN_LABELS`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Token layer, font and dark-mode removal

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — c7f8c39
- [x] 1.2 Type checking passes: `npm run typecheck` — c7f8c39
- [x] 1.3 Unit tests pass: `npm run test` — c7f8c39
- [x] 1.4 Production build succeeds: `npm run build` — c7f8c39
- [x] 1.5 No `dark:` utility remains outside `src/components/ui/` — c7f8c39

#### Manual

- [x] 1.6 Every shadcn primitive renders light with no component edit — c7f8c39
- [x] 1.7 Bricolage Grotesque loads — c7f8c39
- [x] 1.8 Native scrollbars and autofill render light — c7f8c39
- [x] 1.9 Recorded contrast ratios meet AA for their intended use — c7f8c39

### Phase 2: Page shells and headings

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Production build succeeds: `npm run build`
- [x] 2.4 No `text-transparent` remains in `src/`
- [x] 2.5 No `bg-clip-text` remains in `src/`

#### Manual

- [x] 2.6 Every page heading is visible and legible on all eight routes
- [x] 2.7 The three auth pages render identically after the `AuthCard` extraction
- [x] 2.8 Headings render in Bricolage Grotesque, not the fallback

### Phase 3: Surfaces

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Type checking passes: `npm run typecheck`
- [x] 3.3 Unit tests pass: `npm run test`
- [x] 3.4 Integration tests pass: `npm run test:integration`
- [x] 3.5 Production build succeeds: `npm run build`
- [x] 3.6 No `backdrop-blur` remains in `src/`
- [x] 3.7 No `bg-white/` or `border-white/` remains in `src/`

#### Manual

- [x] 3.8 Card boundaries visible on every list and panel
- [x] 3.9 Dashed empty states, room canvas and orphan-tables panel are distinguishable
- [x] 3.10 Inputs look and behave the same after the `<Input />` swap
- [x] 3.11 Dialogs and selects render correctly over the new surfaces

### Phase 4: Text tiers and semantic maps

#### Automated

- [ ] 4.1 Linting passes: `npm run lint`
- [ ] 4.2 Type checking passes: `npm run typecheck`
- [ ] 4.3 Unit tests pass: `npm run test`
- [ ] 4.4 Integration tests pass: `npm run test:integration`
- [ ] 4.5 Production build succeeds: `npm run build`
- [ ] 4.6 No `text-white` outside the two `ui/` destructive hits
- [ ] 4.7 No `text-blue-100` remains in `src/`

#### Manual

- [ ] 4.8 Every screen readable end to end; no white-on-cream
- [ ] 4.9 Three availability states distinguishable on `/menu`
- [ ] 4.10 Three role states plus inactive badge distinguishable on `/staff`
- [ ] 4.11 Active and inactive tables distinguishable on `/room`, dashed border survives
- [ ] 4.12 Links and destructive icons gain contrast on hover, never lose it
- [ ] 4.13 Error and success banners legible
- [ ] 4.14 Keyboard focus rings visible on every interactive element
- [ ] 4.15 All `aria-label`s survived the edits

### Phase 5: Landing page and the signature menu row

#### Automated

- [ ] 5.1 Linting passes: `npm run lint`
- [ ] 5.2 Type checking passes: `npm run typecheck`
- [ ] 5.3 Unit tests pass: `npm run test`
- [ ] 5.4 Integration tests pass: `npm run test:integration`
- [ ] 5.5 Production build succeeds: `npm run build`
- [ ] 5.6 `bg-cosmic` call sites match the convention chosen in phase 2

#### Manual

- [ ] 5.7 The landing page describes OrderLY, not the starter template
- [ ] 5.8 No blurred orbs remain; the page reads warm and light
- [ ] 5.9 The menu row reads as a printed menu line with aligned prices
- [ ] 5.10 The dotted leader behaves at narrow widths and with long names
- [ ] 5.11 A screen reader announces name and price without the leader
- [ ] 5.12 The whole app walked once more at mobile width
