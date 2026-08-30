import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SHAPE_FOOTPRINTS } from "@/lib/room-geometry";
import { cn } from "@/lib/utils";
import { TABLE_SHAPE_LABELS, type RoomTable } from "@/types";

interface DraggableTableProps {
  table: RoomTable;
  scale: number;
  onActivate: () => void;
}

// useDraggable, not useSortable: this is free 2D placement, so there is no list
// order to compute and no arrayMove involved.
export function DraggableTable({ table, scale, onActivate }: DraggableTableProps) {
  // `data.entity` lets the shared onDragEnd in RoomCanvas split tables from room
  // objects without looking the id up across two collections.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id,
    data: { entity: "table" },
  });
  const footprint = SHAPE_FOOTPRINTS[table.shape];

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onActivate}
      aria-label={`Stolik ${String(table.number)}${table.label === null ? "" : `, ${table.label}`}, ${
        TABLE_SHAPE_LABELS[table.shape]
      }${table.is_active ? "" : ", wyłączony"}`}
      className={cn(
        // touch-none is load-bearing: without it a mobile browser scrolls the
        // page on drag and PointerSensor never receives the move events.
        "absolute flex touch-none items-center justify-center border text-sm font-semibold transition-colors",
        table.shape === "circle" ? "rounded-full" : "rounded-lg",
        table.is_active
          ? "border-purple-300/50 bg-purple-500/30 text-white"
          : // Dashed border carries the inactive meaning independently of colour.
            "border-neutral-border bg-neutral-fill text-neutral-fg border-dashed",
        // Above the room objects (z-0/z-10) at all times: a table must stay
        // readable over the furnishing, even while a wall is being dragged.
        isDragging ? "z-30 cursor-grabbing opacity-80" : "z-20 cursor-grab",
      )}
      style={{
        left: table.pos_x * scale,
        top: table.pos_y * scale,
        width: footprint.width * scale,
        height: footprint.height * scale,
        // dnd-kit's transform is already in rendered pixels, so it is applied
        // as-is; only the stored position needs the scale conversion.
        transform: CSS.Translate.toString(transform),
      }}
      {...attributes}
      {...listeners}
    >
      {table.number}
    </button>
  );
}
