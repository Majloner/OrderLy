import type { TableShape } from "@/types";

// The room plan lives in ONE fixed logical coordinate space. The canvas renders
// it scaled to its container, so positions stay comparable across viewports and
// coordinate bounds stay constant zod ranges. Phase 4 adds the scale conversion
// (computeScale / applyDragDelta) to this same module.
export const LOGICAL_CANVAS = { width: 1200, height: 800 } as const;

// Fixed footprint per shape — tables are not resizable in the MVP, so the
// footprint is derived from the shape alone.
export const SHAPE_FOOTPRINTS: Record<TableShape, { width: number; height: number }> = {
  square: { width: 80, height: 80 },
  circle: { width: 80, height: 80 },
  rectangle: { width: 140, height: 80 },
};

function clampAxis(value: number, max: number): number {
  return Math.min(Math.max(Math.round(value), 0), max);
}

// Keeps a table fully inside the canvas, accounting for its footprint. This is
// authoritative on the SERVER: a client cannot push a table off the plan. A drag
// past the edge snaps to the boundary rather than being rejected — clamping is
// the reason the zod bounds can stay shape-agnostic.
export function clampPosition(
  position: { pos_x: number; pos_y: number },
  shape: TableShape,
): { pos_x: number; pos_y: number } {
  const footprint = SHAPE_FOOTPRINTS[shape];

  return {
    pos_x: clampAxis(position.pos_x, LOGICAL_CANVAS.width - footprint.width),
    pos_y: clampAxis(position.pos_y, LOGICAL_CANVAS.height - footprint.height),
  };
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
