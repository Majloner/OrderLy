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
