import { describe, expect, it } from "vitest";
import { applyDragDelta, clampPosition, computeScale, LOGICAL_CANVAS, SHAPE_FOOTPRINTS } from "@/lib/room-geometry";

describe("clampPosition", () => {
  it("leaves an in-bounds position untouched", () => {
    expect(clampPosition({ pos_x: 300, pos_y: 200 }, "square")).toEqual({ pos_x: 300, pos_y: 200 });
  });

  it("clamps to the canvas edge minus the footprint", () => {
    const result = clampPosition({ pos_x: 9999, pos_y: 9999 }, "square");
    expect(result).toEqual({
      pos_x: LOGICAL_CANVAS.width - SHAPE_FOOTPRINTS.square.width,
      pos_y: LOGICAL_CANVAS.height - SHAPE_FOOTPRINTS.square.height,
    });
  });

  it("clamps a rectangle less far on x than a square (wider footprint)", () => {
    const square = clampPosition({ pos_x: 9999, pos_y: 0 }, "square");
    const rectangle = clampPosition({ pos_x: 9999, pos_y: 0 }, "rectangle");
    expect(rectangle.pos_x).toBeLessThan(square.pos_x);
    expect(rectangle.pos_x).toBe(LOGICAL_CANVAS.width - SHAPE_FOOTPRINTS.rectangle.width);
  });

  it("never returns a negative coordinate", () => {
    expect(clampPosition({ pos_x: -500, pos_y: -1 }, "circle")).toEqual({ pos_x: 0, pos_y: 0 });
  });

  it("rounds to integers", () => {
    const result = clampPosition({ pos_x: 10.4, pos_y: 20.6 }, "square");
    expect(result).toEqual({ pos_x: 10, pos_y: 21 });
    expect(Number.isInteger(result.pos_x)).toBe(true);
    expect(Number.isInteger(result.pos_y)).toBe(true);
  });
});

describe("computeScale", () => {
  it("is 1 at the logical canvas width", () => {
    expect(computeScale(LOGICAL_CANVAS.width)).toBe(1);
  });

  it("halves at half the logical width", () => {
    expect(computeScale(LOGICAL_CANVAS.width / 2)).toBe(0.5);
  });

  it("falls back to 1 for a zero or unmeasured container", () => {
    expect(computeScale(0)).toBe(1);
    expect(computeScale(Number.NaN)).toBe(1);
  });

  it("never returns 0 for an absurdly narrow container", () => {
    expect(computeScale(1)).toBeGreaterThan(0);
  });
});

describe("applyDragDelta", () => {
  const start = { pos_x: 100, pos_y: 100 };

  it("moves by exactly the delta at scale 1", () => {
    expect(applyDragDelta(start, { x: 50, y: -30 }, 1, "square")).toEqual({ pos_x: 150, pos_y: 70 });
  });

  // The direction check that a 1200px-wide viewport cannot catch: at half scale,
  // 50 rendered pixels of travel are 100 logical pixels.
  it("doubles the delta at scale 0.5", () => {
    expect(applyDragDelta(start, { x: 50, y: 50 }, 0.5, "square")).toEqual({ pos_x: 200, pos_y: 200 });
  });

  it("halves the delta at scale 2", () => {
    expect(applyDragDelta(start, { x: 50, y: 50 }, 2, "square")).toEqual({ pos_x: 125, pos_y: 125 });
  });

  it("clamps a drag past the right edge to the footprint boundary", () => {
    const result = applyDragDelta(start, { x: 5000, y: 0 }, 1, "rectangle");
    expect(result.pos_x).toBe(LOGICAL_CANVAS.width - SHAPE_FOOTPRINTS.rectangle.width);
  });

  it("clamps a drag past the top-left corner to 0,0", () => {
    expect(applyDragDelta(start, { x: -5000, y: -5000 }, 1, "square")).toEqual({ pos_x: 0, pos_y: 0 });
  });

  it("returns integers even for a fractional scale", () => {
    const result = applyDragDelta(start, { x: 10, y: 10 }, 0.3, "square");
    expect(Number.isInteger(result.pos_x)).toBe(true);
    expect(Number.isInteger(result.pos_y)).toBe(true);
  });

  it("treats a non-positive scale as 1 rather than dividing by zero", () => {
    expect(applyDragDelta(start, { x: 10, y: 10 }, 0, "square")).toEqual({ pos_x: 110, pos_y: 110 });
  });
});
