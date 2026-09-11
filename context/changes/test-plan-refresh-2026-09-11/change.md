---
change_id: test-plan-refresh-2026-09-11
title: Refresh test-planu po wylądowaniu S-05 (menu-availability-toggle)
status: implementing
created: 2026-09-11
updated: 2026-09-12
archived_at: null
---

## Notes

Refresh test-planu po wylądowaniu S-05 (menu-availability-toggle, archiwum: context/archive/2026-09-07-menu-availability-toggle/). Zakres rekoncyliacji (nie przepisujemy §1/§2 bez decyzji): (1) §7 negative space — "brama dostępności: kod nie istnieje (S-05/S-07/S-08)" przestało być prawdą, S-05 dowiózł PATCH availability + politykę kelnera + trigger niezmiennika kolumny; (2) §6 cookbook — dopisać wzorce S-05: wiersz macierzy authz z waiterAllowed (pierwszy staff-write), asercje RLS na trigger kolumnowy (27-29, w tym reorder-RPC-jako-kelner → P0001), wąski PATCH wg activation, pierwszy polling (useMenu, pauzy) i jego weryfikację dwusesyjną; (3) §5/§6 — e2e istnieje (Playwright: auth.setup + 3 specy), a faza AI-native visual została skreślona 2026-09-06 (wiersze "none yet — see §3 Phase 4" do aktualizacji); (4) §4 stack + §8 ledger daty; (5) uwzględnić lekcję "Zmiana middleware/guardów zawsze z test:integration w kryteriach fazy" (lessons.md). Hot-spoty 30 dni (evidence, nie anchory): src/pages, src/components/room, src/components/menu, tests/integration/authz (33 commity). Wywiad pominięty decyzją właściciela — refresh mechaniczny.
