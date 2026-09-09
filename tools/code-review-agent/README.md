# @orderly/code-review-agent

Oskryptowany agent do code review (10xDevs — M5L2/M5L3), zbudowany na
**Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). Niezależna paczka —
nie dotyka zależności głównej aplikacji.

## Kontrakt review (M5L3)

Agent ocenia diff względem **pięciu kryteriów akceptacji PR** zakodowanych w
[prompts/review-system.md](prompts/review-system.md) (źródło: twarde reguły z
AGENTS.md):

1. `tenant-isolation` — scoping po `company_id` + RLS na nowych tabelach
2. `auth-and-secrets` — `prerender = false`, bramka `locals.user`, sekrety tylko z `astro:env/server`
3. `input-validation` — zod na każdym wejściu + poprawna semantyka kodów błędów (400/401/404/500)
4. `framework-conventions` — Astro/React split, `cn()`, hooki w `components/hooks/`, TS strict
5. `test-coverage` — zmieniona logika biznesowa ma test; testy niezależne, bez `waitForTimeout`

Odpowiedź ma wymuszony kształt (walidacja **zod** w [src/lib.mjs](src/lib.mjs)):
status `pass|warn|fail` + znaleziska per kryterium oraz werdykt
`approve|request_changes`. Bramka **wyprowadza werdykt mechanicznie** z
kryteriów (dowolny `fail` ⇒ `request_changes`) — nie ufa werdyktowi modelu;
niezgodność jest raportowana. Odpowiedź poza schematem = exit 1 (pipeline
zatrzymuje zmianę).

## Uruchomienie

```bash
npm run review:sample          # symulowany diff z fixtures/sample.diff
node src/review.mjs -          # diff ze stdin, np. git diff main | node src/review.mjs -
```

Exit code: `0` approve · `3` request_changes (bramka CI) · `1` błąd kontraktu/modelu · `2` złe użycie.

Env:

- `REVIEW_MODEL` — np. `claude-opus-5` (domyślny), `claude-sonnet-5`, `claude-haiku-4-5`
- `REVIEW_TOOLS` — `none` (domyślnie, czysty LLM) | `read` (agent może czytać repo:
  `Read`/`Grep`/`Glob`, np. AGENTS.md i test-plan, zanim oceni — zadanie 4)

## Eval modeli (promptfoo)

`eval/promptfooconfig.yaml` przepuszcza te same 3 diffy
(`fixtures/{sample,clean,subtle}.diff`) przez 3 modele obok siebie przez
provider `exec:` (uruchamia ten sam skrypt agenta, więc działa na subskrypcji
Claude Code — bez klucza API). Asercje sprawdzają kontrakt (5 kryteriów,
spójny werdykt) i oczekiwany werdykt per diff. Zestaw służy też jako **bramka
regresji** przed każdą zmianą promptu:

```bash
cd eval
npx promptfoo eval -c promptfooconfig.yaml --no-cache -o results.json
npx promptfoo view    # opcjonalny podgląd w przeglądarce
```

## CI (M5L3)

`.github/workflows/code-review.yml` (w korzeniu repo) uruchamia agenta na
każdym PR do `main`: diff PR → review → komentarz na PR → bramka (fail przy
`request_changes`). Uwierzytelnianie subskrypcją: wygeneruj token przez
`claude setup-token` i dodaj go jako sekret **`CLAUDE_CODE_OAUTH_TOKEN`**
(Settings → Secrets and variables → Actions). Alternatywa dla rozliczeń za
tokeny: sekret `ANTHROPIC_API_KEY` i podmiana zmiennej w workflow.

## Uwierzytelnianie

SDK uruchamia pod spodem Claude Code CLI i używa jego poświadczeń:

- lokalnie: zalogowana sesja `claude` (subskrypcja) — gdy zobaczysz
  `OAuth session expired`, zaloguj się ponownie w interaktywnym terminalu,
- CI: `CLAUDE_CODE_OAUTH_TOKEN` z `claude setup-token` (subskrypcja) albo
  `ANTHROPIC_API_KEY` (rozliczenie za tokeny) — zawsze jako sekret, nigdy w repo.
