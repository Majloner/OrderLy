import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #4 — IDOR on the photo endpoints. The Storage/service-role edge is MOCKED
// (per the change brief: mock only that edge, never internal modules). That does
// not weaken the test: the owner guard and the ownership check both run BEFORE
// any Storage call, so the mock's call log is exactly the evidence we want —
// denied requests must never reach Storage, and the allowed one must reach it
// with a path the server built from company_id (the client cannot forge it).
// Storage's own prefix-scoping RLS is already proven in supabase/tests/rls_isolation.sql.

const { mintPhotoUploadUrls, removePhotoObjects } = vi.hoisted(() => ({
  mintPhotoUploadUrls: vi.fn(() =>
    Promise.resolve({ full: "https://signed.test/full", thumb: "https://signed.test/thumb" }),
  ),
  removePhotoObjects: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/storage", () => ({ mintPhotoUploadUrls, removePhotoObjects }));

const { POST: photoUrlPost } = await import("@/pages/api/menu/items/[id]/photo-url");
const { PUT: photoPut, DELETE: photoDelete } = await import("@/pages/api/menu/items/[id]/photo");

const uploadBody = { contentType: "image/webp", fullSize: 500_000, thumbSize: 40_000 };

describe("Risk #4 — photo endpoints enforce ownership before touching Storage", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/menu/items/[id]/photo-url", () => {
    it("rejects a waiter with 403 and never mints a URL", async () => {
      const res = await Promise.resolve(
        photoUrlPost(
          buildContext(seed.companyA.waiter, {
            method: "POST",
            params: { id: seed.companyA.resources.itemId },
            body: uploadBody,
          }),
        ),
      );
      expect(res.status).toBe(403);
      expect(mintPhotoUploadUrls).not.toHaveBeenCalled();
    });

    it("rejects the kitchen with 403 and never mints a URL", async () => {
      const res = await Promise.resolve(
        photoUrlPost(
          buildContext(seed.companyA.kitchen, {
            method: "POST",
            params: { id: seed.companyA.resources.itemId },
            body: uploadBody,
          }),
        ),
      );
      expect(res.status).toBe(403);
      expect(mintPhotoUploadUrls).not.toHaveBeenCalled();
    });

    it("rejects owner A targeting a company-B item with 404 and never mints a URL", async () => {
      const res = await Promise.resolve(
        photoUrlPost(
          buildContext(seed.companyA.owner, {
            method: "POST",
            params: { id: seed.companyB.resources.itemId },
            body: uploadBody,
          }),
        ),
      );
      expect(res.status).toBe(404);
      // The decisive assertion: no signed URL was ever minted for company B's item.
      expect(mintPhotoUploadUrls).not.toHaveBeenCalled();
    });

    it("mints for owner A's own item using a server-built {companyId}/{itemId} path", async () => {
      const res = await Promise.resolve(
        photoUrlPost(
          buildContext(seed.companyA.owner, {
            method: "POST",
            params: { id: seed.companyA.resources.itemId },
            body: uploadBody,
          }),
        ),
      );
      expect(res.status).toBe(200);
      expect(mintPhotoUploadUrls).toHaveBeenCalledTimes(1);
      expect(mintPhotoUploadUrls).toHaveBeenCalledWith(`${seed.companyA.company_id}/${seed.companyA.resources.itemId}`);
    });
  });

  describe("PUT /api/menu/items/[id]/photo (attach)", () => {
    it("rejects a waiter with 403", async () => {
      const res = await Promise.resolve(
        photoPut(buildContext(seed.companyA.waiter, { method: "PUT", params: { id: seed.companyA.resources.itemId } })),
      );
      expect(res.status).toBe(403);
    });

    it("rejects owner A targeting a company-B item with 404 and leaves B's row unchanged", async () => {
      const res = await Promise.resolve(
        photoPut(buildContext(seed.companyA.owner, { method: "PUT", params: { id: seed.companyB.resources.itemId } })),
      );
      expect(res.status).toBe(404);

      const { data } = await service
        .from("menu_items")
        .select("photo_path")
        .eq("id", seed.companyB.resources.itemId)
        .single<{ photo_path: string | null }>();
      expect(data?.photo_path).toBeNull();
    });

    it("attaches owner A's own item with a server-built path", async () => {
      const res = await Promise.resolve(
        photoPut(buildContext(seed.companyA.owner, { method: "PUT", params: { id: seed.companyA.resources.itemId } })),
      );
      expect(res.status).toBe(200);

      const { data } = await service
        .from("menu_items")
        .select("photo_path")
        .eq("id", seed.companyA.resources.itemId)
        .single<{ photo_path: string | null }>();
      expect(data?.photo_path).toBe(`${seed.companyA.company_id}/${seed.companyA.resources.itemId}`);
    });
  });

  describe("DELETE /api/menu/items/[id]/photo (clear)", () => {
    it("rejects a waiter with 403 and never removes objects", async () => {
      const res = await Promise.resolve(
        photoDelete(
          buildContext(seed.companyA.waiter, { method: "DELETE", params: { id: seed.companyA.resources.itemId } }),
        ),
      );
      expect(res.status).toBe(403);
      expect(removePhotoObjects).not.toHaveBeenCalled();
    });

    it("rejects owner A targeting a company-B item with 404 and never removes B's objects", async () => {
      const res = await Promise.resolve(
        photoDelete(
          buildContext(seed.companyA.owner, { method: "DELETE", params: { id: seed.companyB.resources.itemId } }),
        ),
      );
      expect(res.status).toBe(404);
      // The service-role remove must never fire for another tenant's prefix.
      expect(removePhotoObjects).not.toHaveBeenCalled();
    });

    it("clears owner A's own item and removes objects under the server-built path", async () => {
      const res = await Promise.resolve(
        photoDelete(
          buildContext(seed.companyA.owner, { method: "DELETE", params: { id: seed.companyA.resources.itemId } }),
        ),
      );
      expect(res.status).toBe(200);
      expect(removePhotoObjects).toHaveBeenCalledTimes(1);
      expect(removePhotoObjects).toHaveBeenCalledWith(`${seed.companyA.company_id}/${seed.companyA.resources.itemId}`);
    });
  });
});
