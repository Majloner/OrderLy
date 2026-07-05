-- Minimal domain tables (F-01, phase 2): tables + menu_items scoped by
-- company_id, with staff CRUD policies and anonymous published-read policies.
--
-- These tables are intentionally MINIMAL. S-03 (menu) and S-06 (room/tables)
-- will ALTER them (categories, allergen tags, photos/thumbnails, visual room
-- layout, QR generation, activation nuances) — they must NOT re-CREATE.
--
-- Anonymous read here is by publish flag (is_active / is_available), not by
-- session: the app supplies the company_id filter resolved from the scanned
-- QR/table. True per-table session isolation arrives with orders in S-08.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number int not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index tables_company_id_idx on public.tables (company_id);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create index menu_items_company_id_idx on public.menu_items (company_id);

-- ---------------------------------------------------------------------------
-- RLS (default-deny)
-- ---------------------------------------------------------------------------
alter table public.tables enable row level security;
alter table public.menu_items enable row level security;

-- Staff: full CRUD scoped to their own company. Role-specific narrowing
-- (owner-only menu editing FR-004, waiter availability toggle FR-007) is
-- refined in S-03/S-05; the foundation grants company-scoped staff CRUD.
create policy tables_staff_all on public.tables
  for all
  to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy menu_items_staff_all on public.menu_items
  for all
  to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Anonymous (QR) read of published data only. No anon INSERT/UPDATE/DELETE.
create policy companies_anon_read on public.companies
  for select
  to anon
  using (true);

create policy tables_anon_read_active on public.tables
  for select
  to anon
  using (is_active);

create policy menu_items_anon_read_available on public.menu_items
  for select
  to anon
  using (is_available);
