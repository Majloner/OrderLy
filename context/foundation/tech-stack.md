---
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
---

## Why this stack

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
