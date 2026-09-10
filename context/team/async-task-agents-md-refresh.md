# Zadanie asynchroniczne: odświeżenie AGENTS.md o narzędzia AI (M5 Innovate)

Granice ustalone PRZED startem (lekcja M5 — praca zdalna/asynchroniczna, pkt 3).

## Cel

Dopisać do `AGENTS.md` zwięzłą sekcję o narzędziach AI repo — pipeline review
(`tools/code-review-agent` + `.github/workflows/code-review.yml`) i paczce
artefaktów (`tools/ai-toolkit` + `.github/workflows/publish-ai-toolkit.yml`) —
oraz skorygować fragmenty, które się zdezaktualizowały. Styl i język (EN)
zgodne z resztą pliku.

## Warunek stopu

Jedna spójna edycja `AGENTS.md`. Gdy czegoś nie da się ustalić z repo —
zostawić `TODO(owner):` zamiast zgadywać. Bez iterowania w nieskończoność,
bez pytań na żywo.

## Zakres plików

- **Zapis:** wyłącznie `AGENTS.md`.
- **Odczyt:** całe repo (README paczek, workflowy, context/foundation/).
- **Zakaz:** commitów (review i commit robi człowiek), zmian w innych plikach.

## Setup / sieć / MCP

- Setup: brak (edycja markdown; bez `npm install`).
- Sieć: niepotrzebna — zakaz wywołań zewnętrznych.
- MCP/konfiguracja repo: niepotrzebne.

## Sekrety i dostępy, których agent NIE dostaje

- Żadnych tokenów (ANTHROPIC/CLAUDE_CODE_OAUTH/GH_PKG), żadnego `gh auth`,
  żadnych `.env*`/`.dev.vars` — zadanie ich nie wymaga, więc ich nie widzi
  (izolowany worktree/sandbox, brak przekazanych zmiennych).

## Checklista review (przed merge)

1. Diff ograniczony do `AGENTS.md`.
2. Fakty zgodne ze stanem repo (nazwy plików, workflowów, sekretów, paczki).
3. Nic istniejącego nie usunięte ani nie przeredagowane bez potrzeby.
4. Styl/formatowanie spójne z resztą pliku (nagłówki, zwięzłość, EN).
5. Prettier/lint repo nie protestuje.

## Wykonanie (uzupełniane po fakcie)

- Tryb kontroli: żądano sandboxa chmurowego (isolation: remote); runtime
  przydzielił **lokalny izolowany worktree** (`.claude/worktrees/agent-…`) —
  granice utrzymane: agent nie widział drzewa roboczego, sekretów ani sieci,
  wynik wrócił jako raport + diff do ludzkiego review.
- Status kroków (2026-09-10):
  - wybór zadania i granic — **wykonane** (ten plik, przed startem),
  - uruchomienie async w tle — **wykonane** (agent ~81 s, 8 tool-calls),
  - sandbox chmurowy — **zablokowane przez dostęp** (downgrade do worktree;
    do sprawdzenia przed wdrożeniem: plan konta / dostępność remote agentów),
  - `/10x-goal-implement` pod `/goal` — **zablokowane przez dostęp**
    (skill niedostępny w tym środowisku; użyto Agent+worktree),
  - review wg checklisty — **wykonane** (zakres ✓ tylko AGENTS.md +9/−1,
    fakty ✓ zweryfikowane na dysku, styl ✓, prettier ✓ po --write),
  - integracja — **wykonane** (patch → gałąź `docs/agents-md-ai-tooling` → PR).
- Decyzja końcowa (co musiałoby się zmienić, żeby tryb był bezpieczny dla
  zespołu): **branch protection na `main` z wymaganymi checkami** — dziś PR
  da się zmergować mimo czerwonych statusów (obserwowane przy PR #39), więc
  bramka agent-review jest umowna; do tego zadaniowe poświadczenia zamiast
  osobistych (`claude setup-token` wisi na koncie jednej osoby i jej limitach —
  potrzebny konto/token serwisowy z rotacją) oraz standard: agent w izolacji
  nigdy nie commituje, a pisemny brief granic (jak ten) jest warunkiem startu.
