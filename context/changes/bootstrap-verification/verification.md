---
bootstrapped_at: 2026-06-01T20:19:22Z
starter_id: dotnet
starter_name: .NET (ASP.NET Core webapi)
project_name: orderly
language_family: dotnet
package_manager: dotnet
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: dotnet list package --vulnerable
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

```yaml
starter_id: dotnet
package_manager: dotnet
project_name: orderly
hints:
  language_family: dotnet
  team_size: solo
  deployment_target: self-host
  ci_provider: bitbucket-pipelines
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: false
    conventions: true
    docs_current: true
    can_judge_agent: false
  has_auth: true
  has_payments: false
  has_realtime: true
  has_ai: false
  has_background_jobs: false
```

### Why this stack

Solo, after-hours OrderLY MVP w 7 tygodni z uwierzytelnianiem, propagacją statusów
i dostępności w czasie rzeczywistym oraz multi-tenant izolacją między firmami —
budowany w stale preferowanej rodzinie .NET / C#. Rejestr ma dokładnie jeden
starter dla pary `(web-app, dotnet)`: ASP.NET Core webapi, ze wszystkimi czterema
bramkami agent-friendly zdanymi i `bootstrapper_confidence: verified`. Custom
path świadomy: bazowy webapi będzie nadbudowany Blazor WebAssembly Standalone z
DevExpress (frontend), FastEndpoints + Entity Framework Core (backend) i strukturą
modular monolith (każdy moduł = projekt implementacji + osobny projekt
API/contract) — zgodnie z globalnymi preferencjami użytkownika. Self-check zwrócił
2/5 nie-zaznaczone (`from_official_starter` — bo to nadbudowa nad bazowym
szablonem, nie oficjalny meta-template; `can_judge_agent` — ryzyko przepuszczenia
niespójności w tej kombinacji warstw); użytkownik świadomie zaakceptował koszt
dodatkowej dyscypliny w pilnowaniu agenta i kompensacji w `CLAUDE.md`. Deployment
self-host (kontener / VPS); CI/CD Bitbucket Pipelines z auto-deploy po merge —
zgodnie z globalną konwencją Bitbucket. UWAGA: `bitbucket-pipelines` jest poza
enumem schematu `hints.ci_provider`; downstream bootstrapper prawdopodobnie
pominie scaffold CI — plik `bitbucket-pipelines.yml` trzeba dodać ręcznie.

## Pre-scaffold verification

| Signal      | Value                                            | Severity | Notes                                                              |
| ----------- | ------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| npm package | not run                                          | n/a      | non-JS starter (language_family: dotnet); npm recency check skipped |
| GitHub repo | not run                                          | n/a      | card.docs_url is https://learn.microsoft.com/aspnet/core — not a GitHub URL, no recency signal available |

Local toolchain present at scaffold time: `dotnet` SDK 10.0.108 (also 8.0.400, 8.0.421 installed).

## Scaffold log

**Resolved invocation**: `dotnet new webapi -n .bootstrap-scaffold --no-restore`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: 6
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: absent in scaffold (template shipped no .gitignore)
**.bootstrap-scaffold cleanup**: deleted

File-by-file move log (scaffold path → cwd path):

| Scaffold file                | Landed in cwd as                | Note                                                  |
| ---------------------------- | ------------------------------- | ----------------------------------------------------- |
| `.bootstrap-scaffold.csproj` | `orderly.csproj`                | renamed to project_name; temp-dir name was throwaway  |
| `.bootstrap-scaffold.http`   | `orderly.http`                  | renamed to project_name; temp-dir name was throwaway  |
| `Program.cs`                 | `Program.cs`                    | moved as-is                                           |
| `appsettings.json`           | `appsettings.json`              | moved as-is                                           |
| `appsettings.Development.json` | `appsettings.Development.json` | moved as-is                                           |
| `Properties/launchSettings.json` | `Properties/launchSettings.json` | moved as-is (directory moved whole)              |

Note: `dotnet new -n` embeds the supplied name into the `.csproj` / `.http` filenames. Because `subdir-then-move` forces `{name}=.bootstrap-scaffold` (a throwaway temp marker), the two project-identity files were renamed to `project_name` (`orderly`) on move-up so the temp marker does not leak into the repo. The `.csproj` is SDK-style and embeds no name in its contents, so the file rename is sufficient — `RootNamespace`/`AssemblyName` default to the file name (`orderly`).

## Post-scaffold audit

**Tool**: `dotnet list package --vulnerable --include-transitive` (run against `orderly.csproj` after `dotnet restore`)
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/0/0 direct of total 0/0/0/0 — `--include-transitive` was set; the tool reported no vulnerable packages at any level.

Clean tree. Tool output: "Dany projekt „orderly" nie ma żadnych pakietów podatnych na zagrożenia, uwzględniając bieżące źródła." (No vulnerable packages, including current sources.)

#### CRITICAL findings

none

#### HIGH findings

none

#### MODERATE findings

none

#### LOW / INFO findings

none

## Hints recorded but not acted on

Every hint bootstrapper v1 read but did not act on. Captured for the future agent-context (M1L4) skill; v1 surfaces but does not compensate.

| Hint                    | Value                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| bootstrapper_confidence | verified                                                                               |
| quality_override        | false                                                                                  |
| path_taken              | custom                                                                                 |
| self_check_answers      | typed: true, from_official_starter: false, conventions: true, docs_current: true, can_judge_agent: false |
| team_size               | solo                                                                                   |
| deployment_target       | self-host                                                                              |
| ci_provider             | bitbucket-pipelines (outside the schema enum — no CI scaffold in v1)                   |
| ci_default_flow         | auto-deploy-on-merge                                                                   |
| has_auth                | true                                                                                   |
| has_payments            | false                                                                                  |
| has_realtime            | true                                                                                   |
| has_ai                  | false                                                                                  |
| has_background_jobs     | false                                                                                  |

Additional context not acted on in v1 (surfaced in conversation):

- **`path_taken: custom`** — the hand-off describes a base `webapi` template intended to be extended with Blazor WebAssembly Standalone + DevExpress (frontend), FastEndpoints + EF Core (backend), and a modular-monolith structure. v1 scaffolded only the base `dotnet new webapi` template; those layers are not added.
- **`ci_provider: bitbucket-pipelines`** — v1 generates no CI files. `bitbucket-pipelines.yml` must be added manually.
- **`has_auth: true`, `has_realtime: true`** — feature flags logged; the scaffold is not modified based on them in v1.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. (This run produced none.)
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. (This run found none.)
- Per your `custom` path: layer in Blazor WebAssembly + DevExpress, FastEndpoints + EF Core, and the modular-monolith project structure on top of the base template.
- Add `bitbucket-pipelines.yml` manually — CI scaffolding is out of scope for v1.
