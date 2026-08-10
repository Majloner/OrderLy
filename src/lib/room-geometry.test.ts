import { describe, expect, it } from "vitest";
import {
  applyDragDelta,
  applyObjectDragDelta,
  applyResizeDelta,
  applyRotateDelta,
  clampObjectCenter,
  clampPosition,
  computeScale,
  LOGICAL_CANVAS,
  OBJECT_SIZE_BOUNDS,
  rotatedFootprint,
  SHAPE_FOOTPRINTS,
} from "@/lib/room-geometry";

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

// A long thin wall is the shape that makes rotation worth having, and the shape
// every off-by-one in this maths shows up on first.
const WALL = { width: 400, height: 20 };

describe("rotatedFootprint", () => {
  it("leaves an unrotated footprint untouched", () => {
    expect(rotatedFootprint(WALL, 0)).toEqual(WALL);
  });

  // The floating-point trap: cos(90°) is 6.1e-17, not 0, so a naive ceil() would
  // report 21 instead of 20 here — and then clamping would be wrong by a pixel at
  // every quarter turn.
  it("swaps the axes at a quarter turn, exactly", () => {
    expect(rotatedFootprint(WALL, 90)).toEqual({ width: 20, height: 400 });
    expect(rotatedFootprint(WALL, 270)).toEqual({ width: 20, height: 400 });
  });

  it("is identical at 180 degrees and at 0", () => {
    expect(rotatedFootprint(WALL, 180)).toEqual(rotatedFootprint(WALL, 0));
  });

  it("grows both axes at 45 degrees", () => {
    // 400·cos45 + 20·sin45 = 296.98, rounded up.
    expect(rotatedFootprint(WALL, 45)).toEqual({ width: 297, height: 297 });
  });

  it("normalizes negative and over-360 angles", () => {
    expect(rotatedFootprint(WALL, -90)).toEqual({ width: 20, height: 400 });
    expect(rotatedFootprint(WALL, 450)).toEqual({ width: 20, height: 400 });
  });

  it("rounds up rather than down, so the box never under-reports", () => {
    const square = rotatedFootprint({ width: 100, height: 100 }, 45);
    // 100·√2 = 141.42
    expect(square).toEqual({ width: 142, height: 142 });
  });
});

describe("clampObjectCenter", () => {
  it("leaves an in-bounds centre untouched", () => {
    expect(clampObjectCenter({ pos_x: 600, pos_y: 400 }, WALL, 0)).toEqual({ pos_x: 600, pos_y: 400 });
  });

  it("stops the centre half a footprint from the left edge", () => {
    const result = clampObjectCenter({ pos_x: 0, pos_y: 400 }, WALL, 0);
    expect(result.pos_x).toBe(WALL.width / 2);
  });

  it("stops the centre half a footprint from the right edge", () => {
    const result = clampObjectCenter({ pos_x: 9999, pos_y: 400 }, WALL, 0);
    expect(result.pos_x).toBe(LOGICAL_CANVAS.width - WALL.width / 2);
  });

  // The whole point of centre anchoring: rotated 90° the wall is only 20px wide,
  // so it may sit far closer to the edge than it could unrotated.
  it("lets a quarter-turned wall reach much closer to the edge", () => {
    const upright = clampObjectCenter({ pos_x: 0, pos_y: 400 }, WALL, 90);
    const flat = clampObjectCenter({ pos_x: 0, pos_y: 400 }, WALL, 0);
    expect(upright.pos_x).toBe(10);
    expect(upright.pos_x).toBeLessThan(flat.pos_x);
  });

  // Reachable, not hypothetical: a full-width wall at 45° spans ~863px, taller
  // than the 800px canvas, so no centre keeps it inside on the y axis.
  it("centres an object whose rotated box is larger than the canvas", () => {
    const result = clampObjectCenter({ pos_x: 0, pos_y: 0 }, { width: 1200, height: 20 }, 45);
    expect(result.pos_y).toBe(LOGICAL_CANVAS.height / 2);
  });

  it("never returns a negative coordinate", () => {
    const result = clampObjectCenter({ pos_x: -9999, pos_y: -9999 }, WALL, 0);
    expect(result.pos_x).toBeGreaterThanOrEqual(0);
    expect(result.pos_y).toBeGreaterThanOrEqual(0);
  });

  it("returns integers for a fractional centre", () => {
    const result = clampObjectCenter({ pos_x: 600.4, pos_y: 400.6 }, WALL, 0);
    expect(result).toEqual({ pos_x: 600, pos_y: 401 });
  });
});

describe("applyObjectDragDelta", () => {
  const centre = { pos_x: 600, pos_y: 400 };

  it("moves by exactly the delta at scale 1", () => {
    expect(applyObjectDragDelta(centre, { x: 50, y: -30 }, 1, WALL, 0)).toEqual({ pos_x: 650, pos_y: 370 });
  });

  it("doubles the delta at scale 0.5", () => {
    expect(applyObjectDragDelta(centre, { x: 50, y: 50 }, 0.5, WALL, 0)).toEqual({ pos_x: 700, pos_y: 500 });
  });

  it("halves the delta at scale 2", () => {
    expect(applyObjectDragDelta(centre, { x: 50, y: 50 }, 2, WALL, 0)).toEqual({ pos_x: 625, pos_y: 425 });
  });

  it("treats a non-positive scale as 1 rather than dividing by zero", () => {
    expect(applyObjectDragDelta(centre, { x: 10, y: 10 }, 0, WALL, 0)).toEqual({ pos_x: 610, pos_y: 410 });
  });

  it("clamps a drag past the right edge, accounting for rotation", () => {
    const flat = applyObjectDragDelta(centre, { x: 5000, y: 0 }, 1, WALL, 0);
    const upright = applyObjectDragDelta(centre, { x: 5000, y: 0 }, 1, WALL, 90);
    expect(flat.pos_x).toBe(LOGICAL_CANVAS.width - WALL.width / 2);
    expect(upright.pos_x).toBe(LOGICAL_CANVAS.width - 10);
  });

  it("returns integers even for a fractional scale", () => {
    const result = applyObjectDragDelta(centre, { x: 10, y: 10 }, 0.3, WALL, 0);
    expect(Number.isInteger(result.pos_x)).toBe(true);
    expect(Number.isInteger(result.pos_y)).toBe(true);
  });
});

describe("applyResizeDelta", () => {
  const centre = { pos_x: 600, pos_y: 400 };
  const BOTTOM_RIGHT = { x: 1, y: 1 } as const;
  const TOP_LEFT = { x: -1, y: -1 } as const;

  it("grows by the delta and moves the centre half as far", () => {
    const result = applyResizeDelta(centre, WALL, 0, BOTTOM_RIGHT, { x: 100, y: 50 }, 1);
    expect(result).toEqual({ pos_x: 650, pos_y: 425, width: 500, height: 70 });
  });

  // The invariant that makes a resize feel like a resize instead of a move: the
  // corner you are NOT holding stays exactly where it was.
  it("keeps the opposite corner still", () => {
    const before = { x: centre.pos_x - WALL.width / 2, y: centre.pos_y - WALL.height / 2 };
    const result = applyResizeDelta(centre, WALL, 0, BOTTOM_RIGHT, { x: 100, y: 50 }, 1);
    const after = { x: result.pos_x - result.width / 2, y: result.pos_y - result.height / 2 };
    expect(after).toEqual(before);
  });

  it("grows towards the top-left when that corner is held", () => {
    const before = { x: centre.pos_x + WALL.width / 2, y: centre.pos_y + WALL.height / 2 };
    const result = applyResizeDelta(centre, WALL, 0, TOP_LEFT, { x: -100, y: -10 }, 1);
    expect(result.width).toBe(500);
    expect(result.height).toBe(30);
    // ...and now the BOTTOM-right corner is the fixed one.
    const after = { x: result.pos_x + result.width / 2, y: result.pos_y + result.height / 2 };
    expect(after).toEqual(before);
  });

  // At 90° the object's own +x axis points down the screen, so a downward drag has
  // to grow the WIDTH. This is the assertion that fails if either of the two
  // rotations in applyResizeDelta is missing or has the wrong sign.
  it("resizes along the object's own axes when rotated", () => {
    const result = applyResizeDelta(centre, WALL, 90, BOTTOM_RIGHT, { x: 0, y: 100 }, 1);
    expect(result.width).toBe(500);
    expect(result.height).toBe(WALL.height);
  });

  it("doubles the delta at half scale", () => {
    const result = applyResizeDelta(centre, WALL, 0, BOTTOM_RIGHT, { x: 50, y: 0 }, 0.5);
    expect(result.width).toBe(500);
  });

  it("clamps to the minimum size and stops moving the centre with it", () => {
    const small = { width: 20, height: 20 };
    const result = applyResizeDelta(centre, small, 0, BOTTOM_RIGHT, { x: -1000, y: -1000 }, 1);
    expect(result.width).toBe(OBJECT_SIZE_BOUNDS.minWidth);
    expect(result.height).toBe(OBJECT_SIZE_BOUNDS.minHeight);
    // Shift derived from the clamped change (-10), not the raw one (-1000).
    expect(result.pos_x).toBe(centre.pos_x - 5);
    expect(result.pos_y).toBe(centre.pos_y - 5);
  });

  it("clamps to the maximum size without drifting", () => {
    const huge = { width: OBJECT_SIZE_BOUNDS.maxWidth, height: 20 };
    const result = applyResizeDelta({ pos_x: 600, pos_y: 400 }, huge, 0, BOTTOM_RIGHT, { x: 500, y: 0 }, 1);
    expect(result.width).toBe(OBJECT_SIZE_BOUNDS.maxWidth);
    expect(result.pos_x).toBe(600);
  });

  // The regression the "keeps the opposite corner still" case above cannot catch,
  // because it uses EVEN deltas. With an odd size change the corner lands on a half
  // pixel, and if both roundings went the same way the error would be monotonic:
  // grow-then-shrink would return the size but leave the object translated 1px,
  // every cycle, unbounded (measured at 50px over 50 nudges before the fix).
  it("returns to the exact starting geometry after an odd grow/shrink cycle", () => {
    const square = { width: 100, height: 100 };
    const start = { pos_x: 600, pos_y: 400 };

    let state = applyResizeDelta(start, square, 0, BOTTOM_RIGHT, { x: 1, y: 1 }, 1);
    expect(state).toEqual({ pos_x: 601, pos_y: 401, width: 101, height: 101 });

    state = applyResizeDelta(state, { width: state.width, height: state.height }, 0, BOTTOM_RIGHT, { x: -1, y: -1 }, 1);
    expect(state).toEqual({ pos_x: 600, pos_y: 400, width: 100, height: 100 });
  });

  it("does not drift over many odd grow/shrink cycles", () => {
    const square = { width: 100, height: 100 };
    let state = { pos_x: 600, pos_y: 400, width: 100, height: 100 };

    for (let i = 0; i < 25; i += 1) {
      const grown = applyResizeDelta(
        state,
        { width: state.width, height: state.height },
        0,
        BOTTOM_RIGHT,
        { x: 1, y: 1 },
        1,
      );
      state = applyResizeDelta(
        grown,
        { width: grown.width, height: grown.height },
        0,
        BOTTOM_RIGHT,
        { x: -1, y: -1 },
        1,
      );
    }

    expect(state).toEqual({ pos_x: 600, pos_y: 400, ...square });
  });

  it("returns integer sizes and coordinates", () => {
    const result = applyResizeDelta(centre, WALL, 33, BOTTOM_RIGHT, { x: 37, y: 11 }, 0.7);
    for (const value of [result.pos_x, result.pos_y, result.width, result.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe("applyRotateDelta", () => {
  const centre = { pos_x: 600, pos_y: 400 };

  // The handle is drawn above the object, so "pointer straight up" must mean 0°.
  it("reads a pointer straight above the centre as 0 degrees", () => {
    expect(applyRotateDelta(centre, { x: 600, y: 300 }, 1)).toBe(0);
  });

  it("walks clockwise through the quadrants", () => {
    expect(applyRotateDelta(centre, { x: 700, y: 400 }, 1)).toBe(90);
    expect(applyRotateDelta(centre, { x: 600, y: 500 }, 1)).toBe(180);
    expect(applyRotateDelta(centre, { x: 500, y: 400 }, 1)).toBe(270);
  });

  it("converts the pointer out of rendered pixels", () => {
    // (350, 200) rendered at scale 0.5 is (700, 400) logical — due east of centre.
    expect(applyRotateDelta(centre, { x: 350, y: 200 }, 0.5)).toBe(90);
  });

  it("snaps to the requested increment", () => {
    // ~84°, which rounds to 90 on a 15° grid.
    expect(applyRotateDelta(centre, { x: 700, y: 390 }, 1, 15)).toBe(90);
  });

  it("never returns 360, wrapping just short of upright to 359", () => {
    const result = applyRotateDelta(centre, { x: 599, y: 300 }, 1);
    expect(result).toBe(359);
  });

  it("returns 0 inside the dead zone rather than snapping wildly", () => {
    expect(applyRotateDelta(centre, { x: 600, y: 400 }, 1)).toBe(0);
  });

  // Dragging the handle across the object's own middle must not throw the angle away:
  // a pointerup there would otherwise commit rotation 0.
  it("holds the supplied angle inside the dead zone", () => {
    expect(applyRotateDelta(centre, { x: 600, y: 400 }, 1, 0, 137)).toBe(137);
    expect(applyRotateDelta(centre, { x: 600, y: 400 }, 1, 0, -1)).toBe(359);
  });
});
