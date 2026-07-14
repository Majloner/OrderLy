import { describe, expect, it } from "vitest";
import { menuCategoryInputSchema, menuItemInputSchema, reorderSchema } from "@/lib/schemas/menu";

const validItem = {
  name: "Pierogi ruskie",
  description: "Z cebulką i okrasą",
  price: 24.5,
  category_id: "9f3c2a10-6d4e-4b8a-9c1d-2e5f7a8b9c0d",
  availability: "available",
  allergens: ["gluten", "milk"],
};

describe("menuItemInputSchema", () => {
  it("accepts a valid item", () => {
    const result = menuItemInputSchema.safeParse(validItem);
    expect(result.success).toBe(true);
  });

  it("trims the name", () => {
    const result = menuItemInputSchema.parse({ ...validItem, name: "  Pizza Margherita  " });
    expect(result.name).toBe("Pizza Margherita");
  });

  it("rejects a whitespace-only name", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 120 characters", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, name: "x".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects a negative price", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, price: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero price", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, price: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a price with three decimal places", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, price: 24.555 });
    expect(result.success).toBe(false);
  });

  it("accepts a price with two decimal places", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, price: 12.99 });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown allergen", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, allergens: ["gluten", "strawberries"] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicated allergens", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, allergens: ["milk", "milk"] });
    expect(result.success).toBe(false);
  });

  it("normalizes a missing description and category to null", () => {
    const { description: _description, category_id: _categoryId, ...rest } = validItem;
    const result = menuItemInputSchema.parse(rest);
    expect(result.description).toBeNull();
    expect(result.category_id).toBeNull();
  });

  it("normalizes an empty description to null", () => {
    const result = menuItemInputSchema.parse({ ...validItem, description: "   " });
    expect(result.description).toBeNull();
  });

  it("rejects a non-uuid category id", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, category_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown availability value", () => {
    const result = menuItemInputSchema.safeParse({ ...validItem, availability: "hidden" });
    expect(result.success).toBe(false);
  });
});

describe("menuCategoryInputSchema", () => {
  it("trims the name", () => {
    const result = menuCategoryInputSchema.parse({ name: "  Zupy  " });
    expect(result.name).toBe("Zupy");
  });

  it("rejects an empty name", () => {
    const result = menuCategoryInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 80 characters", () => {
    const result = menuCategoryInputSchema.safeParse({ name: "x".repeat(81) });
    expect(result.success).toBe(false);
  });
});

describe("reorderSchema", () => {
  it("accepts a non-empty list of uuids", () => {
    const result = reorderSchema.safeParse([
      "9f3c2a10-6d4e-4b8a-9c1d-2e5f7a8b9c0d",
      "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects an empty list", () => {
    const result = reorderSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid entries", () => {
    const result = reorderSchema.safeParse(["not-a-uuid"]);
    expect(result.success).toBe(false);
  });
});
