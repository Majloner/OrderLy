-- Multi-tenant foundation (F-01): staff role enum, companies (tenant),
-- profiles (1:1 auth.users -> company + role), RLS default-deny, resolver
-- helpers (SECURITY DEFINER), and staff read/manage policies.
--
-- Bootstrap note: NO INSERT/DELETE policy is granted to authenticated/anon on
-- companies or profiles. Creating a company + owner is a privileged operation
-- done via the service-role key (bypasses RLS); the authenticated registration
-- flow belongs to S-01. Do NOT add a permissive INSERT ... with check (true)
-- here — it would let any user create companies or self-assign into another
-- company / set their own role to owner (a tenancy hole).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('owner', 'waiter', 'kitchen');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  opening_hours text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role public.staff_role not null,
  full_name text,
  created_at timestamptz not null default now()
);

create index profiles_company_id_idx on public.profiles (company_id);

-- ---------------------------------------------------------------------------
-- Resolver helpers
-- SECURITY DEFINER so they can read profiles regardless of RLS (prevents the
-- policy-on-profiles-reads-profiles recursion); fixed empty search_path with
-- fully-qualified references to block search_path hijack.
-- ---------------------------------------------------------------------------
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.profiles p
  where p.user_id = auth.uid();
$$;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security (default-deny once enabled; access only via policies)
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- companies: staff of the company can read it; only the owner can update it.
create policy companies_select_same_company on public.companies
  for select
  to authenticated
  using (id = public.current_company_id());

create policy companies_update_owner on public.companies
  for update
  to authenticated
  using (id = public.current_company_id() and public.current_staff_role() = 'owner')
  with check (id = public.current_company_id() and public.current_staff_role() = 'owner');

-- profiles: staff can read profiles in their own company. Writes are owner-only
-- (staff provisioning / role changes are an owner action per PRD Access Control
-- + FR-003). A same-company-any-write policy would let a waiter promote itself
-- to owner, so UPDATE is restricted to the owner role.
create policy profiles_select_same_company on public.profiles
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy profiles_update_owner on public.profiles
  for update
  to authenticated
  using (company_id = public.current_company_id() and public.current_staff_role() = 'owner')
  with check (company_id = public.current_company_id() and public.current_staff_role() = 'owner');
