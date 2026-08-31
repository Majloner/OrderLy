---
change_id: ui-redesign
title: UI redesign — "Karta / bistro"
status: archived
created: 2026-07-28
updated: 2026-08-31
archived_at: 2026-08-31T08:05:18Z
---

## Notes

<!-- Design direction locked; implementation intentionally deferred until S-02 (staff-accounts-roles)
     and S-06 (room-layout-tables) merge, so the restyle covers their new screens in one pass with no rebase. -->

### Why
Current look is generic dark SaaS — `bg-cosmic` navy gradient, glassmorphism (`bg-white/10 backdrop-blur`),
blue→purple gradient text, `rounded-2xl`. No connection to the restaurant domain; reads as a templated
"AI dark dashboard". Redesign draws identity from front-of-house hospitality.

### Direction — "Karta / bistro" (light, appetizing, editorial)
- **Palette:** porcelain `#F6F3ED` (canvas), ink `#211F1B` (text), **bottle green `#1E4A3C`** (brand/primary),
  amber `#E0A22B` (accent, sparing), white `#FFFFFF` cards, warm hairline `#E7E1D6` + soft shadow.
  Drop the cosmic gradient + glassmorphism. Deliberately NOT cream+terracotta+serif (the cliché AI
  "restaurant" look). Keep existing semantic availability colors (green available / amber sold_out /
  muted unavailable).
- **Typography:** display = **Bricolage Grotesque** self-hosted via `@fontsource` (wordmark + headings);
  body = clean system sans; **prices and table numbers use tabular figures** (`font-variant-numeric: tabular-nums`).
- **Signature (the one memorable element):** menu rows rendered as a printed-menu line —
  item name → dotted leader → tabular price (`Pierogi ruskie ········· 24,50 zł`), with availability/allergen
  chips. Everything else stays quiet and disciplined in the same warm system.
- **Risk (justified):** an admin tool that feels like a warm bistro menu, not a dark dashboard.

### Scope (when implemented, post-merge)
Foundation: `src/styles/global.css` (light warm theme tokens; retire `.dark`/`bg-cosmic`), `src/layouts/Layout.astro`
(porcelain bg, display font, slim venue wordmark bar), shadcn `src/components/ui/*` (button, input, label, select,
textarea, dialog, checkbox, badge, alert-dialog, card).
Surfaces: login (`auth/*` pages + SignInForm/SignUpForm/FormField/SubmitButton/PasswordToggle/ServerError),
main/dashboard (`index.astro`/Welcome, `dashboard.astro`), settings (`settings.astro`), menu
(`menu/MenuManager|MenuItemRow|MenuItemDialog|CategorySection|CategoryDialog` — MenuItemRow gets the dotted-leader
signature). Plus, post-merge: the new **staff panel (S-02)** and **room-layout editor (S-06)** screens.
Verify in the browser preview (light theme; keyboard focus; reduced motion; responsive to mobile).

### Coordination
Deferred by decision until S-02 + S-06 are merged to the base branch; then the restyle lands on top and covers
all surfaces including their new screens — no worktree rebase needed. `@fontsource/bricolage-grotesque` is the only
new dependency.
