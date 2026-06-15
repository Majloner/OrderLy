---
starter_id: 10x-astro-starter
package_manager: npm
project_name: orderly
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: cloudflare-builds
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Świadoma zmiana fundamentu z .NET na JS/TS: dla solo, 7-tygodniowego MVP OrderLY
(web-app, skala medium) rekomendowany starter pary `(web-app, js)` to **10x Astro
Starter** (Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare),
pewność bootstrapu first-class. Trafia w rdzeń PRD jednym, spójnym stackiem:
**Supabase = PostgreSQL + Auth + Storage + Row Level Security** pokrywa
uwierzytelnianie i role personelu (FR-001/003), **multi-tenant izolację firm przez
RLS** (kluczowy guardrail) oraz storage na zdjęcia menu (FR-005) — bez sklejania
osobnych usług. TypeScript-first z jawnymi schematami Zod na granicach daje
typowanie wymagane przez kryteria agent-friendly. Deploy na Cloudflare Pages/Workers
(@astrojs/cloudflare) to tani edge, a świadoma degradacja realtime → polling co 3–5 s
(stąd `has_realtime: false`) sprawia, że krótkie żądania edge przestają być
problemem, którym byłyby przy trwałych połączeniach SignalR.

Świadome odstępstwa do domknięcia osobno: (1) PRD FR-007 wciąż mówi „w czasie
rzeczywistym" — wymaga aktualizacji `prd.md` na model pollingu, żeby kontrakty się
zgadzały. (2) Generowanie miniatur (FR-005) zrobimy przez Supabase Storage
transforms / Cloudflare Images, nie przez długie zadanie serwerowe (edge runtime
ogranicza długie procesy). (3) Globalna konwencja CI to Bitbucket, ale dla deployu
na Cloudflare wybrano natywne Cloudflare Builds (auto-deploy po merge). (4) Cały
dotychczasowy szkielet .NET (ASP.NET Core, FastEndpoints, EF Core, Blazor+DevExpress,
twarde reguły w AGENTS.md) zostaje zastąpiony — wymaga ponownego bootstrapu.
