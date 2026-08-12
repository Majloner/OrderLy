import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { StaffRole } from "@/types";
import { staffAuthEmail } from "@/lib/staff-identity";
import { anonClient, serviceRoleClient, signInAs, type TestClient } from "./clients";
import { ensureLocalSupabase } from "./local-supabase";

// Seeds two full tenants (2 companies × owner/waiter/kitchen) plus an anon
// principal, and hands back per-principal handles the synthetic-context builder
// consumes. Owners are bootstrapped through the handle_new_user trigger (one
// createUser per tenant seeds company + owner profile + default categories +
// room + venue code); staff are created auth-side then given a profile.
//
// Seeding uses the service-role client and therefore bypasses RLS — a fixture
// must not depend on the very policies it exists to test, matching the
// privileged-seed approach of supabase/tests/rls_isolation.sql. The per-request
// clients returned in each Principal are user-scoped, so the tests still run
// through real RLS.

const PASSWORD = "orderly-integration-pass";

export interface Principal {
  // The user-scoped client a synthetic request injects as `locals.supabase`;
  // its JWT drives current_company_id()/current_staff_role() at the RLS layer.
  client: TestClient;
  user: User | null;
  company_id: string | null;
  role: StaffRole | null;
  display_name: string | null;
}

// One representative row per domain entity, so the isolation suite has concrete
// company-B ids to try (and fail) to reach from company A. categoryId/roomId are
// trigger-seeded defaults; itemId/tableId/objectId are inserted here.
export interface CompanyResources {
  categoryId: string;
  itemId: string;
  roomId: string;
  tableId: string;
  objectId: string;
}

export interface CompanyFixture {
  company_id: string;
  venue_code: string;
  owner: Principal;
  waiter: Principal;
  kitchen: Principal;
  resources: CompanyResources;
}

export interface SeedResult {
  companyA: CompanyFixture;
  companyB: CompanyFixture;
  anon: Principal;
  // Deletes exactly what this seed created (children → parents, then auth users).
  // Call in afterAll so consecutive runs stay identical.
  cleanup: () => Promise<void>;
}

interface OwnerSeed {
  user: User;
  email: string;
  company_id: string;
  venue_code: string;
  full_name: string | null;
}

async function createOwner(service: TestClient, companyName: string): Promise<OwnerSeed> {
  const email = `owner-${randomUUID()}@orderly.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    // company_name is the trigger's gate — it bootstraps the whole tenant.
    user_metadata: { company_name: companyName },
  });
  if (error) {
    throw new Error(`createOwner failed: ${error.message}`);
  }
  const user = data.user;

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("company_id, full_name")
    .eq("user_id", user.id)
    .single<{ company_id: string; full_name: string | null }>();
  if (profileError) {
    throw new Error(`owner profile not found (handle_new_user trigger?): ${profileError.message}`);
  }

  const { data: company, error: companyError } = await service
    .from("companies")
    .select("code")
    .eq("id", profile.company_id)
    .single<{ code: string }>();
  if (companyError) {
    throw new Error(`company not found for owner: ${companyError.message}`);
  }

  return {
    user,
    email,
    company_id: profile.company_id,
    venue_code: company.code,
    full_name: profile.full_name,
  };
}

async function createStaff(
  service: TestClient,
  args: { company_id: string; venue_code: string; login: string; role: StaffRole; fullName: string },
): Promise<User> {
  const email = staffAuthEmail(args.venue_code, args.login);
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: args.fullName },
  });
  if (error) {
    throw new Error(`createStaff(${args.login}) auth failed: ${error.message}`);
  }

  // The test client carries no generated Database type, so PostgREST insert
  // payloads infer `never`; the row is explicit above, so cast at the boundary.
  const profileRow = {
    user_id: data.user.id,
    company_id: args.company_id,
    role: args.role,
    full_name: args.fullName,
    email: null,
    login: args.login,
  };
  const { error: profileError } = await service.from("profiles").insert(profileRow as never);
  if (profileError) {
    throw new Error(`createStaff(${args.login}) profile failed: ${profileError.message}`);
  }

  return data.user;
}

async function seedResources(service: TestClient, companyId: string): Promise<CompanyResources> {
  // The handle_new_user trigger already seeded 4 categories and 1 room per
  // company; take one of each as the reference row.
  const { data: category, error: categoryError } = await service
    .from("menu_categories")
    .select("id")
    .eq("company_id", companyId)
    .order("sort_order")
    .limit(1)
    .single<{ id: string }>();
  if (categoryError) {
    throw new Error(`seedResources: default category missing: ${categoryError.message}`);
  }

  const { data: room, error: roomError } = await service
    .from("rooms")
    .select("id")
    .eq("company_id", companyId)
    .limit(1)
    .single<{ id: string }>();
  if (roomError) {
    throw new Error(`seedResources: default room missing: ${roomError.message}`);
  }

  const itemRow = {
    company_id: companyId,
    name: "Seed Item",
    price: 19.99,
    availability: "available",
    category_id: category.id,
  };
  const { data: item, error: itemError } = await service
    .from("menu_items")
    .insert(itemRow as never)
    .select("id")
    .single<{ id: string }>();
  if (itemError) {
    throw new Error(`seedResources: item insert failed: ${itemError.message}`);
  }

  const tableRow = { company_id: companyId, room_id: room.id, number: 1, is_active: true };
  const { data: table, error: tableError } = await service
    .from("tables")
    .insert(tableRow as never)
    .select("id")
    .single<{ id: string }>();
  if (tableError) {
    throw new Error(`seedResources: table insert failed: ${tableError.message}`);
  }

  // room_objects (#27) requires kind/width/height; pos_x/pos_y/rotation default to 0.
  // The composite (company_id, room_id) FK means the room must be this company's.
  const objectRow = { company_id: companyId, room_id: room.id, kind: "chair", width: 40, height: 40 };
  const { data: object, error: objectError } = await service
    .from("room_objects")
    .insert(objectRow as never)
    .select("id")
    .single<{ id: string }>();
  if (objectError) {
    throw new Error(`seedResources: room_object insert failed: ${objectError.message}`);
  }

  return {
    categoryId: category.id,
    itemId: item.id,
    roomId: room.id,
    tableId: table.id,
    objectId: object.id,
  };
}

export async function seedTwoCompanies(): Promise<SeedResult> {
  await ensureLocalSupabase();
  const service = serviceRoleClient();
  const createdUserIds: string[] = [];
  const createdCompanyIds: string[] = [];

  async function buildCompany(companyName: string): Promise<CompanyFixture> {
    const ownerSeed = await createOwner(service, companyName);
    createdUserIds.push(ownerSeed.user.id);
    createdCompanyIds.push(ownerSeed.company_id);

    const owner: Principal = {
      client: await signInAs({ email: ownerSeed.email, password: PASSWORD }),
      user: ownerSeed.user,
      company_id: ownerSeed.company_id,
      role: "owner",
      display_name: ownerSeed.full_name,
    };

    const staffContext = { company_id: ownerSeed.company_id, venue_code: ownerSeed.venue_code };

    const waiterUser = await createStaff(service, {
      ...staffContext,
      login: "waiter",
      role: "waiter",
      fullName: "Waiter",
    });
    createdUserIds.push(waiterUser.id);
    const waiter: Principal = {
      client: await signInAs({ email: staffAuthEmail(ownerSeed.venue_code, "waiter"), password: PASSWORD }),
      user: waiterUser,
      company_id: ownerSeed.company_id,
      role: "waiter",
      display_name: "Waiter",
    };

    const kitchenUser = await createStaff(service, {
      ...staffContext,
      login: "kitchen",
      role: "kitchen",
      fullName: "Kitchen",
    });
    createdUserIds.push(kitchenUser.id);
    const kitchen: Principal = {
      client: await signInAs({ email: staffAuthEmail(ownerSeed.venue_code, "kitchen"), password: PASSWORD }),
      user: kitchenUser,
      company_id: ownerSeed.company_id,
      role: "kitchen",
      display_name: "Kitchen",
    };

    const resources = await seedResources(service, ownerSeed.company_id);

    return { company_id: ownerSeed.company_id, venue_code: ownerSeed.venue_code, owner, waiter, kitchen, resources };
  }

  const companyA = await buildCompany("Firma A (integration)");
  const companyB = await buildCompany("Firma B (integration)");

  const anon: Principal = { client: anonClient(), user: null, company_id: null, role: null, display_name: null };

  const cleanup = async (): Promise<void> => {
    // Explicit child → parent order so it works regardless of ON DELETE rules.
    // service-role bypasses RLS, so it can delete tables that have no DELETE
    // policy for authenticated roles (e.g. public.tables, QR-permanence).
    // room_objects before rooms: the composite FK cascades on room delete, but an
    // explicit delete keeps cleanup deterministic and independent of cascade rules.
    for (const table of ["menu_items", "menu_categories", "room_objects", "tables", "rooms", "profiles"] as const) {
      await service.from(table).delete().in("company_id", createdCompanyIds);
    }
    await service.from("companies").delete().in("id", createdCompanyIds);
    for (const userId of createdUserIds) {
      await service.auth.admin.deleteUser(userId);
    }
  };

  return { companyA, companyB, anon, cleanup };
}
