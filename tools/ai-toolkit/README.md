# @majloner/ai-toolkit

Zespołowa paczka artefaktów AI (10xDevs — M5L4, model 1: GitHub Packages).
Dystrybuuje skille i reguły Claude Code tak, jak dystrybuuje się kod:
wersjonowana paczka npm w rejestrze `npm.pkg.github.com`.

## Co zawiera

- `skills/code-review/SKILL.md` — skill review oparty o pięć kryteriów
  akceptacji zespołu (tenant isolation, auth & secrets, walidacja wejść,
  konwencje frameworków, pokrycie testami),
- `rules/CLAUDE.md` — kondensat reguł twardych zespołu, wstrzykiwany do
  `CLAUDE.md` konsumenta między znaczniki
  `<!-- BEGIN @majloner/ai-toolkit -->` … `<!-- END @majloner/ai-toolkit -->`.

## Instalacja u konsumenta

1. W repozytorium konsumenta dodaj do `.npmrc` (commitowalne — bez tokenu!):

   ```
   @majloner:registry=https://npm.pkg.github.com
   ```

2. Uwierzytelnienie do rejestru:
   - lokalnie: `npm login --registry=https://npm.pkg.github.com` (PAT z zakresem `read:packages`),
   - CI: sekret `GH_PKG_TOKEN` i linia
     `//npm.pkg.github.com/:_authToken=${GH_PKG_TOKEN}` dopisywana w kroku CI —
     nigdy nie commituj `_authToken`.

3. Instalacja:

   ```
   npm install --save-dev @majloner/ai-toolkit
   ```

`postinstall` uruchamia `install.js`, który:

- kopiuje skille do `.claude/skills/<nazwa>/`,
- wstrzykuje blok reguł do `CLAUDE.md` między sentinelami (idempotentnie —
  ponowna instalacja podmienia blok, nie dubluje go),
- zapisuje manifest `.claude/.ai-toolkit-manifest.json`
  (`{package, version, installedAt, files[]}`),
- nigdy nie wywala `npm install` konsumenta (błędy tylko ostrzegają).

## Odinstalowanie

```
node node_modules/@majloner/ai-toolkit/uninstall.js
npm uninstall @majloner/ai-toolkit
```

Deinstalator czyta manifest, usuwa zainstalowane pliki, wycina blok reguł
z `CLAUDE.md` i kasuje manifest.

## Proces wydania

1. Zmień artefakty i **podbij `version`** w `package.json` (rejestr odrzuca
   duplikaty wersji).
2. Otwórz PR — workflow `publish-ai-toolkit.yml` uruchamia walidację
   (frontmatter skilla, testy instalatora, `npm pack --dry-run`).
3. Merge do `main` publikuje paczkę przez `GITHUB_TOKEN`
   (`permissions: packages: write`) — wydane wersje widać w zakładce
   **Packages** repozytorium.

## Rozwój

```
npm test                                   # testy instalatora (node --test)
npm pack --dry-run                         # co trafi do tarballa
PROJECT_ROOT=$(mktemp -d) node install.js  # instalacja próbna do katalogu tymczasowego
```
