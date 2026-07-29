-- Per-venue staff login (staff-login-identifiers, phase 1).
--
-- Splits the two jobs the email column has been doing. It is currently both the
-- login credential — which Supabase forces to be globally unique via
-- auth.users_email_partial_key, an index in the managed `auth` schema we cannot
-- scope — and a per-venue contact attribute the owner wants to be able to
-- repeat. After this migration:
--
--   companies.code   a short, generated, IMMUTABLE public identifier
--   profiles.login   unique within a venue, null for owners
--   profiles.email   optional contact data, may repeat within a venue
--
-- The auth address itself is not stored: phase 2 derives it from
-- (code, login), so a venue code that does not exist simply yields an address
-- that does not exist. See context/changes/staff-login-identifiers/plan.md.
--
-- FR-011 CONSTRAINT: S-07 will encode companies.code in printed QR codes, which
-- must stay valid forever. The code is therefore generated once and never
-- changes — there is deliberately no owner-facing way to edit it.

-- ---------------------------------------------------------------------------
-- Venue code
-- ---------------------------------------------------------------------------
-- Alphabet excludes 0/O/1/I/L: the code is read off a sticker and dictated over
-- the phone, so visually ambiguous characters would turn into support calls.
-- 6 chars from 31 symbols is ~887M combinations; the caller retries on the
-- unique index rather than trusting a single draw.
create or replace function public.generate_venue_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1),
    ''
  )
  from generate_series(1, 6);
$$;

alter table public.companies add column code text;

-- Backfill before the constraints, in this same transaction — a null would
-- abort the whole migration rather than leave it half applied. The loop retries
-- on the (vanishingly unlikely) collision inside a single backfill.
do $$
declare
  company record;
  candidate text;
begin
  for company in select id from public.companies where code is null loop
    loop
      candidate := public.generate_venue_code();
      exit when not exists (select 1 from public.companies c where c.code = candidate);
    end loop;
    update public.companies set code = candidate where id = company.id;
  end loop;
end $$;

alter table public.companies alter column code set not null;
create unique index companies_code_idx on public.companies (code);

-- ---------------------------------------------------------------------------
-- Staff login
-- ---------------------------------------------------------------------------
-- Nullable: owners have no login, they authenticate with their real email.
alter table public.profiles add column login text;

-- Partial so the many owner rows with a null login do not collide. Lowercased
-- so `Anna` and `anna` are the same login within a venue — phase 2 normalises
-- on the way in, this is the backstop.
create unique index profiles_company_login_idx
  on public.profiles (company_id, lower(login))
  where login is not null;

-- ---------------------------------------------------------------------------
-- Email stops being a credential
-- ---------------------------------------------------------------------------
-- Dropping the per-company unique index is the point of this change: two staff
-- may now share an address, or have none. The index was never the source of the
-- cross-tenant 409 — that came from auth.users — it just has to go for the
-- address to be free-form contact data.
drop index public.profiles_company_email_idx;
alter table public.profiles alter column email drop not null;

-- ---------------------------------------------------------------------------
-- Registration trigger mints the code
-- ---------------------------------------------------------------------------
-- Body starts from 20260728101449_restore_default_room_seed.sql, the current
-- authoritative version (company + owner profile with email + 4 categories +
-- 1 room), with the venue code added. Replacing this function from an older
-- ancestor is exactly the S-02 F1 regression that already dropped S-06's room
-- seed once; assertion 19 in supabase/tests/rls_isolation.sql guards it.
--
-- No retry loop here: a duplicate would raise on companies_code_idx and abort
-- the signup, which is the correct behaviour for a ~1-in-887M event — far
-- better than a loop that could spin inside a trigger.
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
    insert into public.companies (name, code)
      values (new.raw_user_meta_data ->> 'company_name', public.generate_venue_code())
      returning id into new_company_id;

    insert into public.profiles (user_id, company_id, role, full_name, email)
      values (new.id, new_company_id, 'owner', new.raw_user_meta_data ->> 'full_name', new.email);

    insert into public.menu_categories (company_id, name, sort_order)
      values
        (new_company_id, 'Przystawki', 1),
        (new_company_id, 'Dania główne', 2),
        (new_company_id, 'Desery', 3),
        (new_company_id, 'Napoje', 4);

    insert into public.rooms (company_id, name, sort_order)
      values (new_company_id, 'Sala główna', 0);
  end if;

  return new;
end;
$$;
