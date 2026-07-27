-- Staff accounts and roles (S-02): the owner provisions waiter/kitchen accounts
-- and can deactivate them. Adds the two columns `profiles` was missing (a
-- display copy of the login email, and a deactivation timestamp), makes
-- deactivation enforceable schema-wide by teaching both resolvers about it, and
-- opens the INSERT/DELETE policies F-01 deliberately withheld.
--
-- Why the INSERT policy is safe now (cf. the bootstrap note in
-- 20260705212949_tenancy_core.sql): the predicate is three-term — the row must
-- land in the caller's own company, the caller must be the owner, and the role
-- must not be 'owner'. That leaves no path to self-assign into another company
-- or to mint a second owner. Owner registration is unaffected because
-- handle_new_user() is SECURITY DEFINER and bypasses RLS entirely.
--
-- Why a trigger and not a policy for the self-harm guards: an RLS `with check`
-- clause only ever sees the NEW row, so it cannot distinguish "the owner just
-- demoted themselves" from "this row was already a waiter". Comparing OLD to
-- NEW requires a BEFORE UPDATE trigger.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
-- `email` is a denormalized display copy of auth.users.email, written once at
-- provisioning. auth.users is unreadable under RLS from the anon-key client, so
-- without this the staff list has no way to say who an account belongs to.
-- profiles is NOT the source of truth for the login address.
alter table public.profiles add column email text;
alter table public.profiles add column deactivated_at timestamptz;

-- Backfill before the NOT NULL. Every profile has an auth.users row (FK), and
-- this project only ever creates email/password users, so email is present.
-- Both statements share the migration transaction: a NULL would abort the whole
-- migration rather than leave a half-applied state.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.user_id;

alter table public.profiles alter column email set not null;

-- Case-insensitive per-company uniqueness, mirroring menu_categories_company_name_idx.
-- Surfaces as 23505, which the API maps to HTTP 409.
create unique index profiles_company_email_idx on public.profiles (company_id, lower(email));

-- ---------------------------------------------------------------------------
-- Resolvers: deactivation becomes real
-- ---------------------------------------------------------------------------
-- These two functions back EVERY RLS policy in the schema (companies, tables,
-- menu_categories, menu_items, storage.objects). Returning NULL for a
-- deactivated profile makes `company_id = null` -> NULL -> row filtered, so a
-- deactivated account is denied everywhere at once, including on tables later
-- slices have not built yet. Bodies are otherwise unchanged from F-01.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id
  from public.profiles p
  where p.user_id = auth.uid()
    and p.deactivated_at is null;
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
  where p.user_id = auth.uid()
    and p.deactivated_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Policies: the INSERT/DELETE pair F-01 withheld
-- ---------------------------------------------------------------------------
create policy profiles_insert_owner on public.profiles
  for insert
  to authenticated
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner'
              and role <> 'owner');

-- No route in S-02 calls DELETE — removal is the soft `deactivated_at` flag.
-- This ships as the DB-level counterpart to the INSERT policy (and is covered
-- by supabase/tests/rls_isolation.sql) so a future hard-delete or admin cleanup
-- has a tenant-safe path instead of reaching for the service-role key.
-- `user_id <> auth.uid()` stops an owner from deleting themselves.
create policy profiles_delete_owner on public.profiles
  for delete
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner'
         and user_id <> auth.uid());

-- ---------------------------------------------------------------------------
-- Self-harm guard
-- ---------------------------------------------------------------------------
-- Without this, profiles_update_owner lets an owner set their own role to
-- 'waiter'; current_staff_role() then returns 'waiter' and the company has
-- nobody who can write anything — unrecoverable without direct DB access. The
-- same applies to deactivating your own account. Owners may still rename
-- themselves.
--
-- SECURITY INVOKER (the default): the function reads only OLD/NEW and auth.uid()
-- and needs no elevated rights. errcode 42501 (insufficient_privilege) is
-- distinguishable by the API layer, which maps it to HTTP 403 rather than 500.
create or replace function public.guard_profile_self_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'owner' and old.role <> 'owner' then
    raise exception 'Nie można nadać roli właściciela' using errcode = '42501';
  end if;

  -- auth.uid() is NULL for the service role and inside migrations, so these
  -- comparisons are false there and the guard only binds real user sessions.
  if auth.uid() = old.user_id then
    if new.role is distinct from old.role then
      raise exception 'Nie można zmienić własnej roli' using errcode = '42501';
    end if;
    if new.deactivated_at is distinct from old.deactivated_at then
      raise exception 'Nie można dezaktywować własnego konta' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_self_change
  before update on public.profiles
  for each row
  execute function public.guard_profile_self_change();

-- ---------------------------------------------------------------------------
-- Registration trigger: carry the email onto the owner profile
-- ---------------------------------------------------------------------------
-- Same body as 20260708124756_menu_categories_items.sql, with `email` added to
-- the profiles insert. Without this every new owner registration would violate
-- the NOT NULL added above. The `company_name` gate is untouched: staff created
-- through the admin API do not pass it, so this still no-ops for them and their
-- profile row is inserted by the API route instead.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_company_id uuid;
begin
  if new.raw_user_meta_data ? 'company_name' then
    insert into public.companies (name)
      values (new.raw_user_meta_data ->> 'company_name')
      returning id into new_company_id;

    insert into public.profiles (user_id, company_id, role, full_name, email)
      values (new.id, new_company_id, 'owner', new.raw_user_meta_data ->> 'full_name', new.email);

    insert into public.menu_categories (company_id, name, sort_order)
      values
        (new_company_id, 'Przystawki', 1),
        (new_company_id, 'Dania główne', 2),
        (new_company_id, 'Desery', 3),
        (new_company_id, 'Napoje', 4);
  end if;

  return new;
end;
$$;
