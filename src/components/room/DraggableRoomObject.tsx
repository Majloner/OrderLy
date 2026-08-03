import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { ROOM_OBJECT_KIND_LABELS, type RoomObject } from "@/types";
import { ROOM_OBJECT_ICONS, ROOM_OBJECT_STYLES } from "./room-object-visuals";

interface DraggableRoomObjectProps {
  object: RoomObject;
  scale: number;
  onActivate: () => void;
}

export function DraggableRoomObject({ object, scale, onActivate }: DraggableRoomObjectProps) {
  // `data.entity` is how the shared onDragEnd tells an object from a table. Reading
  // it off the drag event beats looking the id up in two arrays: it cannot go stale
  // when the collections change mid-drag.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: object.id,
    data: { entity: "object" },
  });

  const Icon = ROOM_OBJECT_ICONS[object.kind];
  const width = object.width * scale;
  const height = object.height * scale;
  // A 20px-thin wall cannot hold a full-size glyph, so the icon tracks the SHORT
  // side; overflow-hidden takes care of what still does not fit.
  const iconSize = Math.max(8, Math.min(28, Math.min(width, height) * 0.7));

  const label = [
    ROOM_OBJECT_KIND_LABELS[object.kind],
    object.label,
    `${String(object.width)}×${String(object.height)}`,
    object.rotation === 0 ? null : `obrót ${String(object.rotation)}°`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onActivate}
      aria-label={label}
      className={cn(
        // touch-none is load-bearing here for the same reason as on a table:
        // without it a mobile browser scrolls the page and PointerSensor never
        // sees the move events.
        "absolute flex touch-none items-center justify-center overflow-hidden rounded-md border transition-colors",
        ROOM_OBJECT_STYLES[object.kind],
        // Objects sit UNDER tables (z-20/z-30) at every moment, dragging included —
        // furnishing is the backdrop, so a dragged wall must not cover a table.
        isDragging ? "z-10 cursor-grabbing opacity-80" : "z-0 cursor-grab",
      )}
      style={{
        // pos_* is the CENTRE (see src/lib/room-geometry.ts), so half the size comes
        // off to get the top-left corner the layout actually needs.
        left: object.pos_x * scale - width / 2,
        top: object.pos_y * scale - height / 2,
        width,
        height,
        // ORDER MATTERS. CSS transforms apply right to left, so this rotates in the
        // element's own frame and THEN translates in the parent's. Reversed, the
        // drag vector gets rotated too and the object arcs away from the pointer,
        // the more so the larger the angle. transform-origin stays at the default
        // 50% 50%, which is what makes the centre anchoring above consistent.
        transform: [CSS.Translate.toString(transform), `rotate(${String(object.rotation)}deg)`]
          .filter(Boolean)
          .join(" "),
      }}
      {...attributes}
      {...listeners}
    >
      <Icon style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
    </button>
  );
}
