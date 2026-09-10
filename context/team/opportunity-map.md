# Opportunity Map

## Context

- **Project / context**: iTOOLS (`C:\Projekty\itols`) — desktopowa gospodarka narzędziowa (C++Builder + SQL Server), wdrażana per klient przez Advanced Installer; sygnały od wdrożeniowców
- **Data constraint**: mock / lokalne / read-only / niewrażliwe (pierwsza wersja bez kontroli dostępu i audytu; realne bazy klientów poza zakresem do czasu decyzji o dostępach)
- **Date**: 2026-09-06

## Map

| Signal | Existing / default response | Thin complement | First useful version | Data risk | Direction if valuable |
|---|---|---|---|---|---|
| S1: „która wersja iTOOLS u którego klienta" ustalane przez dopytywanie na WhatsAppie | lista SharePoint/Excel + reguła procesu „wdrożenie = wpis"; wersja jest w release (Build Release.ps1 / Advanced Installer) | rejestr wersji jako CSV: klient, wersja, data, kto | digest read-only „kto ma co" renderowany z CSV | niewrażliwe (klient + numer wersji), read-only | internal tool → async/remote (auto check-in wersji) |
| S2: ręczny dobór skryptów SQL uzupełniających bazę zależnie od wersji startowej klienta (`wdrozenie_*.sql`; `schema-obecny.sql` może dryfować) | problem rozwiązany branżowo: DbUp / Flyway / Liquibase (skrypty numerowane wersją + `schema_version`) — **buy, nie build** | manifest „wersja → skrypty" (CSV w repo) + konwencja nazewnicza | read-only planer: wejście = wersja klienta, wyjście = uporządkowana lista brakujących skryptów (dry-run) | mock teraz; realne bazy klientów później (najpierw dostępy + audyt) | buy dla mechaniki + cienki internal tool / CI-gate kompletności migracji |
| S3: skille, prompty i reguły AI kopiowane ręcznie między repozytoriami (10x, itols, iOffice — każde ma własne `.claude/`; w 10x zdublowane `.claude/skills` i `.agents/skills`; prompty m4 kopiowane per repo) | przy 2–3 repo ręczne kopiowanie działa; git submodule / paczka npm / 10x-cli już dystrybuuje artefakty kursu | jedno repo-źródło artefaktów zespołowych + skrypt sync | read-only raport rozjazdu: które repo ma nieaktualne / rozjechane wersje skilli (diff po plikach) | lokalne pliki repo, niewrażliwe | internal tool → **Shared artifact registry** (dokładnie M5L4) |
| S4: brak testów i CI w iTOOLS — każda zmiana weryfikowana przez build + ręczne przeklikanie przepływów (repo-map; plan refaktoru zbudował scenariusze S1–S8 właśnie dlatego) | Jenkins już istnieje w firmie (buduje iOffice); plan L4 wytworzył `build.bat` na produkt + spisane scenariusze ze zrzutami SQL | job CI: build `iTOOLS.cbproj` na push + liczniki ast-grep z reguł planu jako bramka | lokalny skrypt: build + mirror UTF-8 + liczniki (faza 1 planu refaktoru — częściowo już zaprojektowane) | kod repo, niewrażliwe | internal tool → **Review / CI gate** (M5L2–M5L3) |
| S5: historia commitów nieczytelna — zbiorcze paczki („9 niepowiązanych zmian"), aliasy autorów, szum bota CI; analiza co-change zawodzi (repo-mapy obu projektów) | czysty proces, zero kodu: `.mailmap` + konwencja małych commitów (plan L4 już ją zapoczątkował: „jeden commit na plik/krok") | — (nie ma czego budować) | — | n/d | **wait / no build** — reguła procesu, nie narzędzie |

Zastrzeżenia:

- S1 solo rozwiązuje arkusz + rytuał procesu (tarcie przypadkowe — istnieje, bo nikt nie zapisuje wdrożeń); kod opłaca się dopiero na złączeniu z S2.
- S2 solo to adopcja gotowego narzędzia migracyjnego, nie budowa własnego.
- S2 zależy od S1: nie da się dobrać skryptów, nie znając wersji startowej klienta.
- S3 przy obecnej skali (jedna osoba, kilka repo) jest na granicy „default wystarczy" — zyskuje sens, gdy artefakty zacznie konsumować drugi członek zespołu; kierunkowo pokrywa się 1:1 z lekcją M5L4.
- S4 jest częściowo tarciem esencjonalnym (desktop GUI w C++Builder trudno testować automatycznie) — cienki helper celuje tylko w część przypadkową: build i liczniki strukturalne, nie klikanie.
- S5 to uczciwe „no build": problem rozwiązuje konwencja, którą plan refaktoru już wprowadził.

## Recommended First Candidate

```text
Candidate:
  „Kto-ma-co + planer aktualizacji" — rejestr wersji klientów połączony z manifestem skryptów

Reads:
  klienci-wersje.csv (klient, wersja, data, kto) + manifest.csv (wersja → skrypty SQL,
  wyprowadzony z istniejących wdrozenie_*.sql); na start dane mock / historyczne z czatów WhatsApp

Returns:
  read-only digest (markdown/HTML): per klient — obecna wersja, wersja docelowa,
  uporządkowana lista skryptów SQL do zastosowania przy aktualizacji

Does not do:
  nie wykonuje skryptów, nie łączy się z bazami klientów, nie zastępuje procesu
  release (Build Release.ps1 / Advanced Installer), nie jest systemem zgłoszeń

Data risk:
  mock / niewrażliwe (nazwy klientów + numery wersji); zanim planer dotknie realnej
  bazy klienta — najpierw ograniczenie dostępu i audytowalność

Direction if it proves valuable:
  internal tool: rejestr → async/remote (automatyczny check-in wersji z instalatora/aplikacji);
  planer → adopcja DbUp (lub podobnego) + CI-gate pilnujący kompletności migracji w release
```

## Why This Candidate

Rekomendacja po dopisaniu S3–S5 (2026-09-06) bez zmian: S5 to proces, S4 jest częściowo
w toku w planie refaktoru itols, a S3 — naturalny **kandydat #2** — dojrzeje wraz z lekcją
M5L4 (Shared AI Registry) i drugim konsumentem artefaktów. Pierwszeństwo zachowuje
złączenie S1×S2, bo ma dziś najczęstszą powtarzalność i dwie role po dwóch stronach bólu.

Pojedynczo żaden sygnał nie zasługuje na kod — S1 domyka arkusz z regułą procesu, S2 gotowe narzędzie migracyjne. Wartość powstaje na złączeniu dwóch źródeł (rejestr wersji × manifest skryptów) i dwóch ról (wdrożeniowiec pyta, dev odpowiada): dokładnie tego żaden domyślny system sam nie zamknie. Kandydat powtarza się przy każdym wdrożeniu, jest w całości testowalny read-only na mocku, łatwy do wyrzucenia (CSV + skrypt renderujący) i nie udaje systemu of record — wersje nadal pochodzą z release, schemat z repo skryptów.

## Next Direction If Valuable

Wybrana ścieżka: **/10x-mom-test → /10x-shape** (walidacja przed shapingiem). Najtańszy pierwszy krok: rozmowa z wdrożeniowcami o PRZESZŁYCH aktualizacjach — ile razy w ostatnim miesiącu pytali o wersję, kiedy ostatnio dobór skryptów poszedł źle i co to kosztowało. Jeśli problem przeżyje Mom Test, zwalidowana okazja zasila /10x-shape → /10x-prd → /10x-roadmap; mechanika migracji pozostaje kierunkowo „buy" (DbUp/Flyway), budowany jest tylko cienki komplement.
