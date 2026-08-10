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
import { DraggableRoomObject, type RoomObjectTransform } from "./DraggableRoomObject";
import { DraggableTable } from "./DraggableTable";

interface RoomCanvasProps {
  tables: RoomTable[];
  objects: RoomObject[];
  onOpenTable: (table: RoomTable) => void;
  onMoveTable: (table: RoomTable, next: { pos_x: number; pos_y: number }) => void;
  onOpenObject: (object: RoomObject) => void;
  onMoveObject: (object: RoomObject, next: { pos_x: number; pos_y: number }) => void;
  onTransformObject: (object: RoomObject, next: RoomObjectTransform) => void;
}

export function RoomCanvas({
  tables,
  objects,
  onOpenTable,
  onMoveTable,
  onOpenObject,
  onMoveObject,
  onTransformObject,
}: RoomCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const draggedIdRef = useRef<string | null>(null);
  // Selection only exists to reveal an object's resize/rotate handles, so it lives
  // here rather than in the manager: nothing outside the canvas depends on it.
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
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

  // Cleared on a macrotask, not synchronously: the browser fires `click` after the
  // drag settles, and onActivate consults this ref to tell a real click apart from
  // the tail of a finished drag (the 5px threshold separates them).
  const releaseDraggedId = () => {
    setTimeout(() => {
      draggedIdRef.current = null;
    }, 0);
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

    releaseDraggedId();
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      // dnd-kit routes Escape, pointercancel, window resize and visibilitychange to
      // onDragCancel and NEVER falls through to onDragEnd. Without this the ref stays
      // pinned to the cancelled id and every later click on that element is swallowed
      // by the guards below — it can no longer be selected or opened. Window resize is
      // the likeliest trigger, since this canvas is deliberately responsive.
      onDragCancel={releaseDraggedId}
    >
      <div
        ref={surfaceRef}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5"
        style={{ height: LOGICAL_CANVAS.height * scale }}
        // Clicking the backdrop clears the selection and its handles. Only the
        // surface itself counts: a click that bubbled up from a child would undo
        // the selection that child just made.
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedObjectId(null);
          }
        }}
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
            selected={selectedObjectId === object.id}
            onSelect={() => {
              // The click that trails a finished drag must not select, or every drop
              // would leave handles hanging off the object.
              if (draggedIdRef.current !== object.id) {
                setSelectedObjectId(object.id);
              }
            }}
            onOpen={() => {
              if (draggedIdRef.current !== object.id) {
                onOpenObject(object);
              }
            }}
            onTransform={(next) => {
              onTransformObject(object, next);
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
