-- Close Risk #2 — remove the anon read surface that is not company_id-scoped.
--
-- Four SELECT policies granted `to anon` carry no company_id predicate, so anyone
-- holding the public anon key could enumerate, in one request each:
--   companies       -> every restaurant on the platform: name, address, opening
--                      hours and the 6-char VENUE CODE. Staff auth addresses are
--                      derived, never stored (<login>@<code>.staff.orderly.invalid,
--                      src/lib/staff-identity.ts), so a leaked code plus a plausible
--                      first name is a credential guess.
--   tables          -> every active table of every venue with room_id, pos_x/pos_y
--                      and shape — each venue's full floor plan.
--   menu_categories -> every section of every venue's menu.
--   menu_items      -> every published item: name, price, description, allergens,
--                      live sold_out state, and photo_path.
--
-- WHY SUBTRACTION RATHER THAN A PREDICATE.
-- An RLS USING clause is a per-row boolean; it cannot observe whether the client
-- filtered by anything, so a company_id-scoped anon policy needs a company identity
-- available INSIDE the predicate. This stack has none: current_company_id() reads
-- profiles via auth.uid(), which is NULL for anon (the predicate would filter
-- everything, leaving four dead policies pretending to grant something); nothing
-- mints custom anon JWTs; a per-request GUC cannot survive PostgREST's
-- one-transaction-per-request model; and a request-header venue code is
-- client-supplied — a blast-radius reducer, not an authentication boundary.
--
-- WHY THIS IS SAFE TO DO NOW.
-- The surface has no consumer. There is no browser Supabase client
-- (createBrowserClient: zero hits), SUPABASE_URL/KEY are `access: "secret"` and
-- server-only (astro.config.mjs), there are no PUBLIC_* vars, no dynamic/QR page
-- routes exist, and all 24 API routes guard before querying. Dropping these
-- policies changes no application behaviour; RLS is enabled on all four tables, so
-- default-deny applies and anon reads zero rows. The earlier belief — recorded in
-- lessons.md and in the comments of 20260727120000 / 20260804120000 — that this fix
-- had to wait for the S-07/S-08 QR slice was wrong: it only holds if something
-- already consumes the anon surface, and nothing does.
--
-- PRECEDENT. This is what the project already does three times over: public.rooms
-- (20260727120000:75-76), public.room_objects (20260804120000:85-88) and
-- storage.objects (20260721120000:28-32) each deliberately carry NO anon policy,
-- serving a single row/object by exact identifier instead of granting a listing.
--
-- SECOND-ORDER FIX. 20260721120000 withholds anon SELECT on storage.objects
-- specifically to prevent cross-tenant enumeration of the public menu-photos bucket
-- — but menu_items.photo_path ({company_id}/{item_id}/…) was itself anon-readable
-- cross-tenant, so the exact-path list that policy refuses to hand out could be
-- rebuilt from menu_items. Dropping the menu_items policy restores that defence.
--
-- FOR S-07/S-08. When the public QR menu needs anon reads, do NOT re-add
-- `using (true)`. Add a SECURITY DEFINER function that takes the venue code,
-- resolves company_id server-side and returns a COLUMN PROJECTION — RLS is
-- row-level and cannot withhold companies.address or companies.code, which is why
-- a policy is the wrong tool for a public endpoint.

drop policy companies_anon_read on public.companies;

drop policy tables_anon_read_active on public.tables;

drop policy menu_categories_anon_read on public.menu_categories;

drop policy menu_items_anon_read_visible on public.menu_items;
