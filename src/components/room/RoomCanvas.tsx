import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { applyDragDelta, applyObjectDragDelta, computeScale, LOGICAL_CANVAS } from "@/lib/room-geometry";
import type { RoomObject, RoomTable } from "@/types";
import { DraggableRoomObject } from "./DraggableRoomObject";
import { DraggableTable } from "./DraggableTable";

interface RoomCanvasProps {
  tables: RoomTable[];
  objects: RoomObject[];
  onOpenTable: (table: RoomTable) => void;
  onMoveTable: (table: RoomTable, next: { pos_x: number; pos_y: number }) => void;
  onOpenObject: (object: RoomObject) => void;
  onMoveObject: (object: RoomObject, next: { pos_x: number; pos_y: number }) => void;
}

export function RoomCanvas({ tables, objects, onOpenTable, onMoveTable, onOpenObject, onMoveObject }: RoomCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const draggedIdRef = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // The surface keeps the logical aspect ratio, so only its width drives scale.
  // Writing height back from a width observation cannot loop: scale is a pure
  // function of width, so React bails out on the identical state value.
  useEffect(() => {
    const node = surfaceRef.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.clientWidth;
      setScale(computeScale(width));
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    draggedIdRef.current = String(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;

    if (delta.x !== 0 || delta.y !== 0) {
      // One DndContext holds both entities, so the handler splits on the `entity`
      // tag each draggable carries in its data. Tables and objects clamp by
      // different rules — corner-anchored by fixed shape footprint vs
      // centre-anchored by the row's own size and rotation — so they cannot share
      // a code path.
      if (active.data.current?.entity === "object") {
        const object = objects.find((candidate) => candidate.id === active.id);
        if (object) {
          onMoveObject(
            object,
            applyObjectDragDelta(object, delta, scale, { width: object.width, height: object.height }, object.rotation),
          );
        }
      } else {
        const table = tables.find((candidate) => candidate.id === active.id);
        if (table) {
          onMoveTable(table, applyDragDelta(table, delta, scale, table.shape));
        }
      }
    }

    // Cleared on a macrotask, not synchronously: the browser fires `click` after
    // dragEnd, and onActivate consults this ref to tell a real click apart from
    // the tail of a finished drag (5px threshold separates them).
    setTimeout(() => {
      draggedIdRef.current = null;
    }, 0);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        ref={surfaceRef}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5"
        style={{ height: LOGICAL_CANVAS.height * scale }}
      >
        {/* Objects render FIRST and carry lower z-index classes, so furnishing sits
            under the tables. Painting order plus explicit z-* is enough here because
            every node is absolutely positioned — wrapping each layer in its own
            `absolute inset-0` container would work too, but then the wrapper would
            swallow pointer events unless every layer juggled pointer-events-none. */}
        {objects.map((object) => (
          <DraggableRoomObject
            key={object.id}
            object={object}
            scale={scale}
            onActivate={() => {
              if (draggedIdRef.current !== object.id) {
                onOpenObject(object);
              }
            }}
          />
        ))}
        {tables.map((table) => (
          <DraggableTable
            key={table.id}
            table={table}
            scale={scale}
            onActivate={() => {
              if (draggedIdRef.current !== table.id) {
                onOpenTable(table);
              }
            }}
          />
        ))}
      </div>
    </DndContext>
  );
}
