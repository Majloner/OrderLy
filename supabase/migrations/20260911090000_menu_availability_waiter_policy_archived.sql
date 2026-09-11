-- S-05 impl-review F3 (defense-in-depth): the waiter availability policy
-- admitted ARCHIVED rows. The API route filters `.is("archived_at", null)`,
-- but the DB is the enforcement layer of record — a waiter hitting PostgREST
-- directly could flip availability on an archived item of their own company.
-- Narrow the policy so the DB matches the route contract exactly. Owner writes
-- are untouched (menu_items_update_owner has no archived predicate on purpose:
-- the owner's full PUT is already route-filtered and archive/unarchive is
-- owner territory).
alter policy menu_items_update_availability_waiter on public.menu_items
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'waiter'
         and archived_at is null)
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'waiter'
              and archived_at is null);
