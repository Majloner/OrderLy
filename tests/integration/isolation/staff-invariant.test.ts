import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as staffPost } from "@/pages/api/staff/index";
import { PUT as staffPut } from "@/pages/api/staff/[id]";
import { staffAuthEmail } from "@/lib/staff-identity";
import { anonClient, serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #6 — an owner must not be able to lock themselves out, and nobody may be
// promoted to `owner`. The SQL suite already proves the trigger and the RLS
// predicates (assertions 13-18); what is untested is the ROUTE: that it returns
// the right status and that the invariant actually HOLDS afterwards.
//
// The status differs by which layer catches the attempt, and that distinction is
// the point of these cases:
//   - self role / self deactivate -> 403 from the route's self-guard, BEFORE the DB
//   - role: "owner"               -> 400 from the schema enum, BEFORE the DB
// The trigger's 42501 -> 403 mapping is therefore unreachable through this
// endpoint; it stays proven at the SQL layer rather than being forced here.
//
// Every case asserts the EFFECT (role / deactivated_at unchanged), never the
// message text of a trigger.

describe("Risk #6 — staff self-privilege invariant holds at the route", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  const ownerId = () => {
    const id = seed.companyA.owner.user?.id;
    if (!id) {
      throw new Error("seed missing company A owner id");
    }
    return id;
  };

  const waiterId = () => {
    const id = seed.companyA.waiter.user?.id;
    if (!id) {
      throw new Error("seed missing company A waiter id");
    }
    return id;
  };

  const readProfile = async (userId: string) =>
    service
      .from("profiles")
      .select("role, deactivated_at, full_name")
      .eq("user_id", userId)
      .single<{ role: string; deactivated_at: string | null; full_name: string | null }>();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("refuses an owner demoting itself (403) and leaves the role untouched", async () => {
    const res = await Promise.resolve(
      staffPut(
        buildContext(seed.companyA.owner, { method: "PUT", params: { id: ownerId() }, body: { role: "waiter" } }),
      ),
    );
    expect(res.status).toBe(403);

    const { data } = await readProfile(ownerId());
    expect(data?.role).toBe("owner");
  });

  it("refuses an owner deactivating itself (403) and leaves the account active", async () => {
    const res = await Promise.resolve(
      staffPut(
        buildContext(seed.companyA.owner, { method: "PUT", params: { id: ownerId() }, body: { active: false } }),
      ),
    );
    expect(res.status).toBe(403);

    const { data } = await readProfile(ownerId());
    expect(data?.deactivated_at).toBeNull();
  });

  it("refuses promoting a waiter to owner (400 from the schema) and leaves the role unchanged", async () => {
    const res = await Promise.resolve(
      staffPut(
        buildContext(seed.companyA.owner, { method: "PUT", params: { id: waiterId() }, body: { role: "owner" } }),
      ),
    );
    // 400, not the trigger's 403: `owner` is not in STAFF_ASSIGNABLE_ROLES, so the
    // request never reaches the database.
    expect(res.status).toBe(400);

    const { data } = await readProfile(waiterId());
    expect(data?.role).toBe("waiter");
  });

  it("refuses provisioning a second owner (400) without creating a profile or an auth user", async () => {
    const login = "secondowner";
    const password = "orderly-integration-pass";

    const before = await service.from("profiles").select("user_id").eq("company_id", seed.companyA.company_id);

    const res = await Promise.resolve(
      staffPost(
        buildContext(seed.companyA.owner, {
          method: "POST",
          body: { login, email: null, password, full_name: null, role: "owner" },
        }),
      ),
    );
    expect(res.status).toBe(400);

    const after = await service.from("profiles").select("user_id").eq("company_id", seed.companyA.company_id);
    expect((after.data ?? []).length).toBe((before.data ?? []).length);

    // The schema rejects before createStaffAuthUser runs, so the derived address
    // must not exist — no orphan auth user left holding the login.
    const { error } = await anonClient().auth.signInWithPassword({
      email: staffAuthEmail(seed.companyA.venue_code, login),
      password,
    });
    expect(error).not.toBeNull();
  });

  it("allows an owner to rename itself (200) without touching role or activation", async () => {
    const res = await Promise.resolve(
      staffPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: ownerId() },
          body: { full_name: "Renamed Owner" },
        }),
      ),
    );
    expect(res.status).toBe(200);

    const { data } = await readProfile(ownerId());
    expect(data?.full_name).toBe("Renamed Owner");
    expect(data?.role).toBe("owner");
    expect(data?.deactivated_at).toBeNull();
  });
});
