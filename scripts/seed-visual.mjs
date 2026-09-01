// Seeds the dedicated VISUAL tenant with fixed, deterministic content so the
// visual-review screenshots are stable run-to-run (test-plan §3 Phase 4).
//
// Unlike the e2e seed spec (timestamp-suffixed names), everything here is a
// fixed literal: same names, same prices, same positions on every run. The
// script is idempotent by full reset — it deletes the tenant's menu/room
// content and re-inserts the fixture, so a re-run yields identical screens.
//
// The owner account is bootstrapped through the same handle_new_user trigger
// the integration fixtures and auth.setup.ts provisioning use: one createUser
// with user_metadata.company_name seeds company + owner profile + defaults.
// "Already registered" counts as success.
//
// Env (shared with .env.e2e — see .env.e2e.example):
//   E2E_SUPABASE_URL, E2E_SUPABASE_SERVICE_ROLE_KEY — MUST point at the same
//     Supabase project the dev server uses (.dev.vars), or the captured screens
//     will not show this content.
//   E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD — the owner auth.setup.ts signs in as.
//   E2E_COMPANY_NAME — optional, defaults to "E2E Lokal".

import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.e2e");
} catch {
  // .env.e2e is optional — CI passes everything through env.
}

const url = process.env.E2E_SUPABASE_URL;
const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const companyName = process.env.E2E_COMPANY_NAME ?? "E2E Lokal";

if (!url || !serviceKey || !ownerEmail || !ownerPassword) {
  console.error(
    "seed-visual: E2E_SUPABASE_URL, E2E_SUPABASE_SERVICE_ROLE_KEY, E2E_OWNER_EMAIL and " +
      "E2E_OWNER_PASSWORD are required (see .env.e2e.example).",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey);

async function ensureOwner() {
  const { data, error } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { company_name: companyName },
  });
  if (!error) {
    return data.user.id;
  }
  if (!/already|exists/i.test(error.message)) {
    throw new Error(`ensureOwner: createUser failed: ${error.message}`);
  }
  // Existing user — resolve the id by listing (local/CI stacks hold a handful of users).
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    throw new Error(`ensureOwner: listUsers failed: ${listError.message}`);
  }
  const user = list.users.find((u) => u.email === ownerEmail);
  if (!user) {
    throw new Error(`ensureOwner: ${ownerEmail} reported as existing but not found via listUsers.`);
  }
  return user.id;
}

async function companyIdFor(userId) {
  const { data, error } = await admin.from("profiles").select("company_id").eq("user_id", userId).single();
  if (error) {
    throw new Error(`companyIdFor: owner profile missing (handle_new_user trigger?): ${error.message}`);
  }
  return data.company_id;
}

// Full reset of the tenant's visual-relevant content. Child → parent order;
// service-role bypasses RLS (tables has no DELETE policy by design — QR
// permanence — which is irrelevant for this throwaway visual tenant).
async function resetContent(companyId) {
  for (const table of ["menu_items", "menu_categories", "room_objects", "tables", "rooms"]) {
    const { error } = await admin.from(table).delete().eq("company_id", companyId);
    if (error) {
      throw new Error(`resetContent: delete from ${table} failed: ${error.message}`);
    }
  }
}

async function insert(table, rows) {
  const { data, error } = await admin.from(table).insert(rows).select("id");
  if (error) {
    throw new Error(`insert into ${table} failed: ${error.message}`);
  }
  return data.map((row) => row.id);
}

async function seed(companyId) {
  // --- Menu: 2 categories, items covering all three availability states -----
  // (the availability semantic map must render every state — capture waits on
  // "Pierogi ruskie"; keep names in sync with tests/e2e/visual/capture.visual.ts)
  const [przystawkiId, daniaId] = await insert("menu_categories", [
    { company_id: companyId, name: "Przystawki", sort_order: 1 },
    { company_id: companyId, name: "Dania główne", sort_order: 2 },
  ]);

  await insert("menu_items", [
    {
      company_id: companyId,
      category_id: przystawkiId,
      name: "Chleb ze smalcem",
      description: "Domowy smalec ze skwarkami, ogórek kiszony",
      price: 12.0,
      availability: "available",
      sort_order: 1,
    },
    {
      company_id: companyId,
      category_id: przystawkiId,
      name: "Tatar wołowy",
      description: "Polędwica, żółtko, cebula, korniszon",
      price: 36.0,
      availability: "sold_out",
      sort_order: 2,
    },
    {
      company_id: companyId,
      category_id: daniaId,
      name: "Schabowy z kapustą",
      description: "Klasyka — panierowany schab, kapusta zasmażana",
      price: 42.0,
      availability: "available",
      sort_order: 1,
    },
    {
      company_id: companyId,
      category_id: daniaId,
      name: "Pierogi ruskie",
      description: "Ręcznie lepione, okrasa z cebulki",
      price: 29.0,
      availability: "unavailable",
      sort_order: 2,
    },
  ]);

  // --- Room: 1 room, tables in both lifecycle states, all 9 object kinds ----
  // All 9 kinds on canvas so the rubric's invisible-object check (F1 class,
  // ui-redesign impl-review) has every equipment kind as a subject.
  const [roomId] = await insert("rooms", [{ company_id: companyId, name: "Sala główna", sort_order: 1 }]);

  await insert("tables", [
    { company_id: companyId, room_id: roomId, number: 1, shape: "square", pos_x: 150, pos_y: 250, is_active: true },
    { company_id: companyId, room_id: roomId, number: 2, shape: "circle", pos_x: 420, pos_y: 300, is_active: true },
    {
      company_id: companyId,
      room_id: roomId,
      number: 3,
      shape: "rectangle",
      pos_x: 700,
      pos_y: 250,
      is_active: true,
    },
    { company_id: companyId, room_id: roomId, number: 4, shape: "square", pos_x: 420, pos_y: 550, is_active: false },
  ]);

  // pos_x/pos_y are the object's CENTRE (see RoomObject in src/types.ts);
  // logical canvas is 1200×800.
  await insert("room_objects", [
    { company_id: companyId, room_id: roomId, kind: "wall", pos_x: 600, pos_y: 12, width: 1150, height: 20 },
    { company_id: companyId, room_id: roomId, kind: "door", pos_x: 120, pos_y: 60, width: 80, height: 20 },
    { company_id: companyId, room_id: roomId, kind: "window", pos_x: 900, pos_y: 60, width: 140, height: 16 },
    { company_id: companyId, room_id: roomId, kind: "bar", pos_x: 950, pos_y: 650, width: 280, height: 70 },
    { company_id: companyId, room_id: roomId, kind: "plant", pos_x: 70, pos_y: 720, width: 40, height: 40 },
    { company_id: companyId, room_id: roomId, kind: "stairs", pos_x: 1130, pos_y: 300, width: 90, height: 130 },
    { company_id: companyId, room_id: roomId, kind: "toilet", pos_x: 70, pos_y: 500, width: 60, height: 60 },
    { company_id: companyId, room_id: roomId, kind: "till", pos_x: 700, pos_y: 660, width: 60, height: 40 },
    { company_id: companyId, room_id: roomId, kind: "chair", pos_x: 260, pos_y: 480, width: 40, height: 40 },
  ]);
}

const userId = await ensureOwner();
const companyId = await companyIdFor(userId);
await resetContent(companyId);
await seed(companyId);
console.log(`seed-visual: tenant "${companyName}" (${companyId}) reset with fixed visual fixture.`);
