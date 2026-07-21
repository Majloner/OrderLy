-- Menu item photos (S-04): photo reference columns + public Storage bucket +
-- owner-only Storage RLS.
--
-- Photos are generated client-side (no `sharp` on workerd, no paid image
-- transforms on the free tier) and uploaded to Supabase Storage via signed
-- upload URLs. The menu_items row keeps only a path reference plus a cache-bust
-- timestamp; the object bytes never pass through the Worker.

-- ---------------------------------------------------------------------------
-- Columns (ALTER only — never re-CREATE menu_items)
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column photo_path text,
  add column photo_updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Public bucket for menu photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('menu-photos', 'menu-photos', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Storage RLS: owner-only writes scoped to the caller's company prefix.
-- Object path is {company_id}/{item_id}/{full|thumb}.webp, so
-- (storage.foldername(name))[1] is the company_id.
--
-- NO anon SELECT policy: public downloads go through the CDN by exact UUID
-- path; withholding SELECT/list prevents cross-tenant enumeration — this is
-- how the "anon RLS reads must be scoped by company_id" lesson is honored at
-- the Storage layer (a public bucket serves single objects by path but does
-- not allow listing without a SELECT policy).
-- ---------------------------------------------------------------------------
create policy menu_photos_insert_owner on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.current_staff_role() = 'owner'
  );

create policy menu_photos_update_owner on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.current_staff_role() = 'owner'
  )
  with check (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.current_staff_role() = 'owner'
  );

create policy menu_photos_delete_owner on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.current_staff_role() = 'owner'
  );
