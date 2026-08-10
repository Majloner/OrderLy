# UI Redesign — "Karta / bistro" — Plan Brief

> Full plan: `context/changes/ui-redesign/plan.md`
> Design direction: `context/changes/ui-redesign/change.md`

## What & Why

The current look is generic dark SaaS — navy gradient, glassmorphism, blue-to-purple
gradient text. It reads as a templated AI dashboard with no connection to the
restaurant domain. This replaces it with a light, warm "Karta / bistro" theme:
porcelain canvas, ink text, bottle-green brand, amber used sparingly, and one
memorable signature — menu rows rendered like a printed menu line.

## Starting Point

The token layer already exists and `:root` already holds a light set — but
`Layout.astro:18` hardcodes `class="dark"` and everything outside `src/components/ui/`
paints itself with literal Tailwind classes over a custom `bg-cosmic` gradient.
Measured: **32 of 45 `.astro`/`.tsx` files, ~197 class-bearing lines**. No web font
is loaded anywhere. No test asserts on markup, and no DOM environment exists in
either vitest project.

## Desired End State

Every screen renders on porcelain with ink text and white cards separated by warm
hairlines. Headings are set in self-hosted Bricolage Grotesque. The menu list reads
like a printed card: `Pierogi ruskie ·········· 24,50 zł`. Nothing anywhere renders
white-on-cream.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Palette and direction | Porcelain / ink / bottle green / amber | Locked before planning; deliberately not the cream-and-terracotta AI "restaurant" cliché. | change.md |
| Timing | Now, after S-02 and S-06 | The change deferred itself until both merged so the restyle covers their screens in one pass — both are in `main`. | change.md |
| Token layer | Named bistro tokens **plus** shadcn tokens aliasing them | Keeps the palette legible in code while all nine shadcn primitives retheme with zero edits. | Plan |
| Dark mode | Removed outright, not retuned | There is no toggle, no `prefers-color-scheme` handling and no persistence, so a second theme would be untested dead code. | Plan |
| Semantic colours | Four semantic token triples | Five class maps × three states is fifteen contrast decisions; made once centrally, not scattered across five files. | Plan |
| Headings | Flat brand colour + display font | The gradient was the only thing making headings special; typography does it better and cannot go invisible. | Plan |
| Font | `@fontsource-variable`, self-hosted | No third-party origin, no privacy cost, one file for all weights. | Plan |
| Landing page | Rewritten, not restyled | It is still starter-template copy, and its blurred orbs would become muddy smears on cream. | Plan |
| Shared components | Extract `AuthCard`, `ErrorPanel`, `EmptyState` | 27 of the ~197 hits live in blocks that are identical character-for-character. | Plan |
| Signature element | `MenuItemRow` only | One signature element works; five stop being signature. Tabular figures elsewhere deferred. | Plan |
| Verification | Checklist + browser review | No DOM environment exists; building axe/Lighthouse infrastructure under cover of a restyle would be scope creep. | Plan |
| Phasing | By layer, not by screen | Each kind of change is made once everywhere, so the same decision is never repeated in different files. | Plan |

## Scope

**In scope:** the token layer and semantic tokens; removing dark mode; the display
font; nine page shells; eight gradient headings; every glass surface and text tier;
five semantic class maps; three extracted shared components; deduplicating two
hand-rolled input recipes; rewriting the landing page; the signature menu row.

**Out of scope:** dark mode; any dependency beyond the font; layout, component-library
or route changes; accessibility automation; tabular figures outside the menu row; copy
changes anywhere but the landing page.

## Architecture / Approach

Layer by layer. The token layer goes first because it is load-bearing: once `:root`
carries bistro values and `class="dark"` is gone, all nine shadcn primitives are
correct with no component edits, and later phases have a stable vocabulary to
substitute into. Named tokens and shadcn tokens are both defined, with the shadcn set
aliasing the named set — that is what preserves the free primitive retheme while
keeping the palette readable in code.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tokens, font, dark-mode removal | The vocabulary everything else uses; shadcn primitives already correct | Contrast decisions made here propagate everywhere — getting a token wrong is invisible until phase 4 |
| 2. Shells and headings | Porcelain canvas; eight headings off the gradient; `AuthCard` | The one pattern that fails **invisibly** — a surviving `text-transparent` is an unreadable heading with no error |
| 3. Surfaces | Real cards with hairlines; `ErrorPanel`/`EmptyState`; input dedupe | Largest mechanical phase; extraction and restyle must be separate commits or the diff is unreviewable |
| 4. Text tiers and semantic maps | The app becomes readable; meaning-bearing colours restored | Two opacity scales map to two tiers, not one at reduced opacity; `border-dashed` on inactive tables must survive |
| 5. Landing page and signature row | Front door describes the product; the printed-menu line | Both are creative rather than mechanical, so "done" is a judgement call |

**Prerequisites:** S-02 and S-06 merged (both in `main` — this was the change's own
stated precondition). Nothing else.

**Estimated effort:** ~5 sessions, one per phase, with a manual-verification pause
after each.

## Open Risks & Assumptions

- **The app looks worse between phases 1 and 4.** After the token phase, shadcn is
  correct but feature components still paint for a dark background. This is inherent
  to a layer-by-layer split — do not judge the result before phase 4.
- `prettier-plugin-tailwindcss` reorders class strings on every touched file, so diffs
  will be large but semantically empty. Run `npm run format` before review.
- Contrast is verified by a human checklist. Nothing enforces it, and no test will
  catch a regression later.
- `aria-label`s are not test-guarded; a careless refactor could drop them silently.
- `dashboard.astro` and `Layout.astro` have been shared append-only files across
  parallel slices — check for in-flight branches before each phase.

## Success Criteria (Summary)

- Every screen is readable, with no white-on-cream and no invisible heading or border.
- The five semantic states — availability, staff role, table activity — remain
  distinguishable at a glance.
- The menu reads like a printed card, and the front door describes OrderLY.
