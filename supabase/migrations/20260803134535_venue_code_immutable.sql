-- Fix (impl-review F2): make companies.code actually immutable.
--
-- 20260728150833_venue_code_and_staff_login.sql states the code "is generated
-- once and never changes — there is deliberately no owner-facing way to edit
-- it", and FR-011 requires exactly that so printed QR codes stay valid forever.
-- But companies_update_owner (20260705212949_tenancy_core.sql:80-84) is a
-- table-wide FOR UPDATE with no column restriction, so nothing in the schema
-- enforced it. The invariant rested entirely on the absence of a route:
-- src/pages/api/company/profile.ts happens to build an explicit three-column
-- patch. One careless `select("*")`-style update would break it.
--
-- Why that failure would be severe rather than merely wrong: staff auth
-- addresses are DERIVED from the code and never stored (src/lib/staff-identity.ts).
-- Changing the code makes every staff address in that venue uncomposable, so
-- every waiter and kitchen account is permanently locked out — there is no
-- password reset, no mail delivery, and the login is immutable by design.
--
-- Mirrors profiles_guard_self_change: the rule the comments already claim is
-- now enforced where it belongs. errcode 42501 so the API layer can map it to
-- 403 the same way it maps the profiles trigger.

create or replace function public.guard_company_code_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'Kod lokalu jest niezmienny' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger companies_guard_code_immutable
  before update on public.companies
  for each row
  execute function public.guard_company_code_immutable();
