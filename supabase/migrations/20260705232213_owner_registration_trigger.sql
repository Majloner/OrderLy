-- Owner registration (S-01): on a new auth user carrying `company_name` in
-- signup metadata, atomically create the company + owner profile. Runs as a
-- SECURITY DEFINER trigger so it bypasses RLS (companies/profiles grant no
-- authenticated INSERT — see F-01). No service_role key needed on the edge.
--
-- CONDITIONAL on `company_name`: staff creation in S-02 (which will NOT pass
-- company_name) must not spawn a stray company — the trigger no-ops for it.

create function public.handle_new_user()
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

    insert into public.profiles (user_id, company_id, role, full_name)
      values (new.id, new_company_id, 'owner', new.raw_user_meta_data ->> 'full_name');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
