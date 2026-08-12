import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as objectPut, DELETE as objectDelete } from "@/pages/api/room/objects/[id]";
import { PATCH as objectTransformPatch } from "@/pages/api/room/objects/[id]/transform";
import { serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #1/#4 for room_objects (#27) — mirrors the table cross-tenant suite:
// owner A targets company B's object id, gets 404 (RLS filters the row so the
// guard admits the owner but the statement matches nothing), and B's row is
// verified unchanged. DELETE matters here in a way it cannot for tables: an
// object CAN be deleted by its owner (no permanent QR pinned to a chair), so
// "deletable" must not mean "deletable across tenants".
//
// The 3-role guard coverage for these routes already lives in the Risk #3 authz
// matrix; this suite is strictly about the tenant boundary.

const transformBody = { pos_x: 300, pos_y: 300, width: 60, height: 60, rotation: 90 };

const objectBody = (roomId: string) => ({
  room_id: roomId,
  kind: "bar",
  label: "HACKED",
  pos_x: 200,
  pos_y: 200,
  width: 80,
  height: 80,
  rotation: 0,
});

describe("Risk #4 — room_objects cross-tenant writes are denied and leave company B unchanged", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("owner A cannot PUT company B's object", async () => {
    const res = await Promise.resolve(
      objectPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyB.resources.objectId },
          // Deliberately A's OWN room: the room-ownership check then passes, so the
          // only thing that can reject this is the tenant boundary on the object id
          // itself (RLS filters B's row → 0 updated → 404). Using B's room would
          // short-circuit at the room check (400) and prove nothing about objects.
          body: objectBody(seed.companyA.resources.roomId),
        }),
      ),
    );
    expect([401, 403]).not.toContain(res.status);
    expect(res.status).toBe(404);

    const { data } = await service
      .from("room_objects")
      .select("label, kind")
      .eq("id", seed.companyB.resources.objectId)
      .single<{ label: string | null; kind: string }>();
    expect(data?.label).not.toBe("HACKED");
    expect(data?.kind).toBe("chair");
  });

  it("owner A cannot PATCH transform company B's object", async () => {
    const res = await Promise.resolve(
      objectTransformPatch(
        buildContext(seed.companyA.owner, {
          method: "PATCH",
          params: { id: seed.companyB.resources.objectId },
          body: transformBody,
        }),
      ),
    );
    expect(res.status).toBe(404);

    const { data } = await service
      .from("room_objects")
      .select("width, height, rotation")
      .eq("id", seed.companyB.resources.objectId)
      .single<{ width: number; height: number; rotation: number }>();
    expect(data?.width).toBe(40);
    expect(data?.height).toBe(40);
    expect(data?.rotation).toBe(0);
  });

  it("owner A cannot DELETE company B's object (deletable ≠ deletable cross-tenant)", async () => {
    const res = await Promise.resolve(
      objectDelete(
        buildContext(seed.companyA.owner, { method: "DELETE", params: { id: seed.companyB.resources.objectId } }),
      ),
    );
    expect(res.status).toBe(404);

    const { data } = await service
      .from("room_objects")
      .select("id")
      .eq("id", seed.companyB.resources.objectId)
      .maybeSingle<{ id: string }>();
    expect(data?.id).toBe(seed.companyB.resources.objectId);
  });

  it("owner A CAN delete their own object (proves the 404s above are the tenant boundary, not a broken route)", async () => {
    const res = await Promise.resolve(
      objectDelete(
        buildContext(seed.companyA.owner, { method: "DELETE", params: { id: seed.companyA.resources.objectId } }),
      ),
    );
    expect(res.status).toBe(200);

    const { data } = await service
      .from("room_objects")
      .select("id")
      .eq("id", seed.companyA.resources.objectId)
      .maybeSingle<{ id: string }>();
    expect(data).toBeNull();
  });
});
