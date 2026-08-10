import { describe, expect, it } from "vitest";
import { LOGICAL_CANVAS, OBJECT_SIZE_BOUNDS } from "@/lib/room-geometry";
import {
  roomInputSchema,
  roomObjectInputSchema,
  roomObjectPositionSchema,
  roomObjectTransformSchema,
  tableInputSchema,
  tablePositionSchema,
} from "@/lib/schemas/room";

const validTable = {
  room_id: "9f3c2a10-6d4e-4b8a-9c1d-2e5f7a8b9c0d",
  number: 12,
  label: "Przy oknie",
  shape: "circle",
  pos_x: 240,
  pos_y: 160,
  is_active: true,
};

describe("tableInputSchema", () => {
  it("accepts a valid table", () => {
    const result = tableInputSchema.safeParse(validTable);
    expect(result.success).toBe(true);
  });

  it("rejects table number zero", () => {
    const result = tableInputSchema.safeParse({ ...validTable, number: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts table number 1", () => {
    const result = tableInputSchema.safeParse({ ...validTable, number: 1 });
    expect(result.success).toBe(true);
  });

  it("accepts table number 999", () => {
    const result = tableInputSchema.safeParse({ ...validTable, number: 999 });
    expect(result.success).toBe(true);
  });

  it("rejects table number 1000", () => {
    const result = tableInputSchema.safeParse({ ...validTable, number: 1000 });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional table number", () => {
    const result = tableInputSchema.safeParse({ ...validTable, number: 4.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown shape", () => {
    const result = tableInputSchema.safeParse({ ...validTable, shape: "hexagon" });
    expect(result.success).toBe(false);
  });

  it("trims the label", () => {
    const result = tableInputSchema.parse({ ...validTable, label: "  Przy barze  " });
    expect(result.label).toBe("Przy barze");
  });

  it("normalizes a missing label to null", () => {
    const { label: _label, ...rest } = validTable;
    const result = tableInputSchema.parse(rest);
    expect(result.label).toBeNull();
  });

  it("normalizes a whitespace-only label to null", () => {
    const result = tableInputSchema.parse({ ...validTable, label: "   " });
    expect(result.label).toBeNull();
  });

  it("rejects a label longer than 80 characters", () => {
    const result = tableInputSchema.safeParse({ ...validTable, label: "x".repeat(81) });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid room id", () => {
    const result = tableInputSchema.safeParse({ ...validTable, room_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative position", () => {
    expect(tableInputSchema.safeParse({ ...validTable, pos_x: -1 }).success).toBe(false);
    expect(tableInputSchema.safeParse({ ...validTable, pos_y: -1 }).success).toBe(false);
  });

  it("rejects a position beyond the logical canvas", () => {
    const overX = { ...validTable, pos_x: LOGICAL_CANVAS.width + 1 };
    const overY = { ...validTable, pos_y: LOGICAL_CANVAS.height + 1 };
    expect(tableInputSchema.safeParse(overX).success).toBe(false);
    expect(tableInputSchema.safeParse(overY).success).toBe(false);
  });

  it("rejects a fractional position", () => {
    const result = tableInputSchema.safeParse({ ...validTable, pos_x: 10.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean is_active", () => {
    const result = tableInputSchema.safeParse({ ...validTable, is_active: "yes" });
    expect(result.success).toBe(false);
  });
});

describe("roomInputSchema", () => {
  it("trims the name", () => {
    const result = roomInputSchema.parse({ name: "  Taras  " });
    expect(result.name).toBe("Taras");
  });

  it("rejects an empty name", () => {
    expect(roomInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(roomInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name longer than 60 characters", () => {
    expect(roomInputSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });
});

describe("tablePositionSchema", () => {
  it("accepts an in-bounds position", () => {
    expect(tablePositionSchema.safeParse({ pos_x: 0, pos_y: 0 }).success).toBe(true);
  });

  it("accepts the canvas maximum (the server clamps by footprint)", () => {
    const atMax = { pos_x: LOGICAL_CANVAS.width, pos_y: LOGICAL_CANVAS.height };
    expect(tablePositionSchema.safeParse(atMax).success).toBe(true);
  });

  it("rejects a position beyond the canvas", () => {
    const beyond = { pos_x: LOGICAL_CANVAS.width + 1, pos_y: 0 };
    expect(tablePositionSchema.safeParse(beyond).success).toBe(false);
  });

  it("rejects a missing coordinate", () => {
    expect(tablePositionSchema.safeParse({ pos_x: 100 }).success).toBe(false);
  });
});

const validObject = {
  room_id: "9f3c2a10-6d4e-4b8a-9c1d-2e5f7a8b9c0d",
  kind: "wall",
  label: "Ściana od kuchni",
  pos_x: 240,
  pos_y: 160,
  width: 400,
  height: 20,
  rotation: 0,
};

describe("roomObjectInputSchema", () => {
  it("accepts a valid object", () => {
    expect(roomObjectInputSchema.safeParse(validObject).success).toBe(true);
  });

  it("accepts every known kind", () => {
    for (const kind of ["wall", "chair", "door", "window", "bar", "plant", "stairs", "toilet", "till"]) {
      expect(roomObjectInputSchema.safeParse({ ...validObject, kind }).success).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, kind: "aquarium" }).success).toBe(false);
  });

  it("accepts rotation at both ends of the range", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, rotation: 0 }).success).toBe(true);
    expect(roomObjectInputSchema.safeParse({ ...validObject, rotation: 359 }).success).toBe(true);
  });

  // 360 is the wrap point, not a value — otherwise two distinct numbers mean the
  // same angle and the DB check has to allow a duplicate.
  it("rejects rotation of 360 or more", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, rotation: 360 }).success).toBe(false);
    expect(roomObjectInputSchema.safeParse({ ...validObject, rotation: 900 }).success).toBe(false);
  });

  it("rejects negative rotation", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, rotation: -1 }).success).toBe(false);
  });

  it("rejects fractional rotation", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, rotation: 45.5 }).success).toBe(false);
  });

  it("accepts the size bounds and rejects just outside them", () => {
    const { minWidth, maxWidth, minHeight, maxHeight } = OBJECT_SIZE_BOUNDS;
    expect(roomObjectInputSchema.safeParse({ ...validObject, width: minWidth }).success).toBe(true);
    expect(roomObjectInputSchema.safeParse({ ...validObject, width: maxWidth }).success).toBe(true);
    expect(roomObjectInputSchema.safeParse({ ...validObject, width: minWidth - 1 }).success).toBe(false);
    expect(roomObjectInputSchema.safeParse({ ...validObject, width: maxWidth + 1 }).success).toBe(false);
    expect(roomObjectInputSchema.safeParse({ ...validObject, height: minHeight }).success).toBe(true);
    expect(roomObjectInputSchema.safeParse({ ...validObject, height: maxHeight }).success).toBe(true);
    expect(roomObjectInputSchema.safeParse({ ...validObject, height: maxHeight + 1 }).success).toBe(false);
  });

  it("rejects a fractional size", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, width: 100.5 }).success).toBe(false);
  });

  it("normalizes an empty or missing label to null", () => {
    const { label: _label, ...rest } = validObject;
    expect(roomObjectInputSchema.parse(rest).label).toBeNull();
    expect(roomObjectInputSchema.parse({ ...validObject, label: "   " }).label).toBeNull();
  });

  it("trims the label", () => {
    expect(roomObjectInputSchema.parse({ ...validObject, label: "  Bar  " }).label).toBe("Bar");
  });

  it("rejects a non-uuid room id", () => {
    expect(roomObjectInputSchema.safeParse({ ...validObject, room_id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a centre beyond the logical canvas", () => {
    const overX = { ...validObject, pos_x: LOGICAL_CANVAS.width + 1 };
    const overY = { ...validObject, pos_y: LOGICAL_CANVAS.height + 1 };
    expect(roomObjectInputSchema.safeParse(overX).success).toBe(false);
    expect(roomObjectInputSchema.safeParse(overY).success).toBe(false);
  });
});

describe("roomObjectTransformSchema", () => {
  const validTransform = { pos_x: 240, pos_y: 160, width: 400, height: 20, rotation: 45 };

  it("accepts a geometry-only payload", () => {
    expect(roomObjectTransformSchema.safeParse(validTransform).success).toBe(true);
  });

  // The whole reason the route exists: a resize must not be able to carry the three
  // columns a concurrent rename or room move owns.
  it("strips room_id, kind and label rather than writing them", () => {
    const parsed = roomObjectTransformSchema.parse({
      ...validTransform,
      room_id: "9f3c2a10-6d4e-4b8a-9c1d-2e5f7a8b9c0d",
      kind: "bar",
      label: "smuggled",
    });
    expect(parsed).toEqual(validTransform);
  });

  it("keeps the bounds of the full input schema", () => {
    expect(roomObjectTransformSchema.safeParse({ ...validTransform, rotation: 360 }).success).toBe(false);
    expect(roomObjectTransformSchema.safeParse({ ...validTransform, width: 9 }).success).toBe(false);
    expect(roomObjectTransformSchema.safeParse({ ...validTransform, height: 801 }).success).toBe(false);
  });

  it("rejects a partial payload", () => {
    const { rotation: _rotation, ...withoutRotation } = validTransform;
    expect(roomObjectTransformSchema.safeParse(withoutRotation).success).toBe(false);
  });
});

describe("roomObjectPositionSchema", () => {
  it("accepts a bare centre", () => {
    expect(roomObjectPositionSchema.safeParse({ pos_x: 120, pos_y: 240 }).success).toBe(true);
  });

  it("rejects a centre beyond the canvas", () => {
    expect(roomObjectPositionSchema.safeParse({ pos_x: LOGICAL_CANVAS.width + 1, pos_y: 0 }).success).toBe(false);
  });

  it("rejects a missing coordinate", () => {
    expect(roomObjectPositionSchema.safeParse({ pos_x: 100 }).success).toBe(false);
  });
});
