import type { RoomObjectKind, TableShape } from "@/types";

// The room plan lives in ONE fixed logical coordinate space. The canvas renders
// it scaled to its container, so positions stay comparable across viewports and
// coordinate bounds stay constant zod ranges.
export const LOGICAL_CANVAS = { width: 1200, height: 800 } as const;

export interface Footprint {
  width: number;
  height: number;
}

// Fixed footprint per shape — tables are not resizable in the MVP, so the
// footprint is derived from the shape alone.
export const SHAPE_FOOTPRINTS: Record<TableShape, Footprint> = {
  square: { width: 80, height: 80 },
  circle: { width: 80, height: 80 },
  rectangle: { width: 140, height: 80 },
};

// Objects carry their own size, so these are only the starting values a new one
// gets. They matter more than they look: "add a wall" has to produce a long thin
// rectangle immediately, or the most common kind is the worst served — every
// insert would need two manual edits before it means anything.
export const ROOM_OBJECT_DEFAULT_SIZES: Record<RoomObjectKind, Footprint> = {
  wall: { width: 400, height: 20 },
  chair: { width: 40, height: 40 },
  door: { width: 80, height: 20 },
  window: { width: 100, height: 20 },
  bar: { width: 240, height: 60 },
  plant: { width: 50, height: 50 },
  stairs: { width: 120, height: 80 },
  toilet: { width: 120, height: 120 },
  till: { width: 80, height: 60 },
};

// One source of truth for object dimensions, shared by the zod schema and the DB
// check constraint. Bounds are shared across kinds rather than per-kind: a venue
// is entitled to a genuinely large bar, and nine pairs of limits would be a lot
// of validation surface for little gain.
export const OBJECT_SIZE_BOUNDS = {
  minWidth: 10,
  maxWidth: LOGICAL_CANVAS.width,
  minHeight: 10,
  maxHeight: LOGICAL_CANVAS.height,
} as const;

// ---------------------------------------------------------------------------
// Corner-anchored clamping — TABLES.
//
// A table's pos_x/pos_y is its TOP-LEFT corner and it never rotates, so keeping
// it on the canvas is a plain per-axis clamp against the canvas minus the
// footprint. Objects use the centre-anchored functions further down instead.
// ---------------------------------------------------------------------------

function clampAxis(value: number, max: number): number {
  // max goes negative if a footprint is wider than the canvas; floor it at 0 so
  // the result is never a negative coordinate.
  return Math.min(Math.max(Math.round(value), 0), Math.max(max, 0));
}

// Keeps a top-left-anchored box fully inside the canvas. This is authoritative on
// the SERVER: a client cannot push a table off the plan. A drag past the edge
// snaps to the boundary rather than being rejected — clamping is the reason the
// zod bounds can stay shape-agnostic.
export function clampToFootprint(
  position: { pos_x: number; pos_y: number },
  footprint: Footprint,
): { pos_x: number; pos_y: number } {
  return {
    pos_x: clampAxis(position.pos_x, LOGICAL_CANVAS.width - footprint.width),
    pos_y: clampAxis(position.pos_y, LOGICAL_CANVAS.height - footprint.height),
  };
}

export function clampPosition(
  position: { pos_x: number; pos_y: number },
  shape: TableShape,
): { pos_x: number; pos_y: number } {
  return clampToFootprint(position, SHAPE_FOOTPRINTS[shape]);
}

// How many rendered pixels one logical pixel occupies. The canvas keeps the
// logical aspect ratio, so one factor covers both axes. Floored at a small value
// so a container measured at 0 (first paint, display:none) cannot produce a 0 or
// Infinity scale and blow up applyDragDelta.
export function computeScale(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 1;
  }
  return Math.max(containerWidth / LOGICAL_CANVAS.width, 0.1);
}

// Translate a dnd-kit drag delta into a new LOGICAL position.
//
// This is the one piece of non-obvious maths in the editor: the delta arrives in
// RENDERED pixels while positions are stored in logical ones, so it must be
// DIVIDED by the scale here (rendering multiplies by it). Getting the direction
// wrong is invisible at exactly 1200px wide, where scale === 1 — which is why
// this lives in a tested pure function instead of inside the canvas component.
export function applyDragDelta(
  position: { pos_x: number; pos_y: number },
  delta: { x: number; y: number },
  scale: number,
  shape: TableShape,
): { pos_x: number; pos_y: number } {
  const safeScale = scale > 0 ? scale : 1;

  return clampPosition(
    {
      pos_x: position.pos_x + delta.x / safeScale,
      pos_y: position.pos_y + delta.y / safeScale,
    },
    shape,
  );
}

// ---------------------------------------------------------------------------
// Centre-anchored clamping — ROOM OBJECTS.
//
// An object's pos_x/pos_y is its CENTRE. That is not cosmetic: objects rotate
// freely, and a rotated rectangle anchored by its top-left corner produces
// legitimate NEGATIVE coordinates — a 400x20 wall turned 90° and pushed to the
// left edge has its centre at x = 10 but its unrotated corner at x = -190, a
// value neither the zod bound nor a sane CHECK constraint would accept. Anchored
// at the centre the clamp always returns [0, 1200] x [0, 800], so objects reuse
// the very same coordinate bounds as tables. The cost is that rendering must
// subtract half the size (left = (pos_x - width / 2) * scale).
// ---------------------------------------------------------------------------

// cos(90°) is 6.1e-17 rather than 0 in floating point, so a plain Math.ceil turns
// a 20px extent into 21 at every quarter turn. Snap to the nearest integer when
// we are within noise of one, and only round up for genuinely fractional values.
function ceilWithinTolerance(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) < 1e-9 ? nearest : Math.ceil(value);
}

// Axis-aligned bounding box of a rectangle rotated by `rotation` degrees about
// its centre. Rounded UP (outside the tolerance window) so the box that clamping
// works with is never smaller than the shape it has to contain.
export function rotatedFootprint(footprint: Footprint, rotation: number): Footprint {
  const radians = (((rotation % 360) + 360) % 360) * (Math.PI / 180);
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));

  return {
    width: ceilWithinTolerance(footprint.width * cos + footprint.height * sin),
    height: ceilWithinTolerance(footprint.height * cos + footprint.width * sin),
  };
}

function clampCentreAxis(value: number, extent: number, limit: number): number {
  const lower = Math.ceil(extent / 2);
  const upper = Math.floor(limit - extent / 2);

  // The rotated box is larger than the canvas on this axis (a 1200x20 wall at 45°
  // spans ~863px against a height of 800), so NO centre keeps it fully inside.
  // Centre it explicitly rather than letting the order of min/max decide.
  if (lower > upper) {
    return Math.round(limit / 2);
  }

  return Math.min(Math.max(Math.round(value), lower), upper);
}

// Keeps a rotated object's bounding box inside the canvas. Authoritative on the
// SERVER, exactly like clampPosition is for tables.
export function clampObjectCenter(
  centre: { pos_x: number; pos_y: number },
  footprint: Footprint,
  rotation: number,
): { pos_x: number; pos_y: number } {
  const bounds = rotatedFootprint(footprint, rotation);

  return {
    pos_x: clampCentreAxis(centre.pos_x, bounds.width, LOGICAL_CANVAS.width),
    pos_y: clampCentreAxis(centre.pos_y, bounds.height, LOGICAL_CANVAS.height),
  };
}

// The object counterpart of applyDragDelta. The delta needs no angular
// correction: dnd-kit reports pointer travel in screen space, so dividing by the
// scale is the whole conversion. Rotation only enters through the clamp.
export function applyObjectDragDelta(
  centre: { pos_x: number; pos_y: number },
  delta: { x: number; y: number },
  scale: number,
  footprint: Footprint,
  rotation: number,
): { pos_x: number; pos_y: number } {
  const safeScale = scale > 0 ? scale : 1;

  return clampObjectCenter(
    {
      pos_x: centre.pos_x + delta.x / safeScale,
      pos_y: centre.pos_y + delta.y / safeScale,
    },
    footprint,
    rotation,
  );
}
