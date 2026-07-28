import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { applyDragDelta, computeScale, LOGICAL_CANVAS } from "@/lib/room-geometry";
import type { RoomTable } from "@/types";
import { DraggableTable } from "./DraggableTable";

interface RoomCanvasProps {
  tables: RoomTable[];
  onOpenTable: (table: RoomTable) => void;
  onMoveTable: (table: RoomTable, next: { pos_x: number; pos_y: number }) => void;
}

export function RoomCanvas({ tables, onOpenTable, onMoveTable }: RoomCanvasProps) {
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
    const table = tables.find((candidate) => candidate.id === active.id);
    if (table && (delta.x !== 0 || delta.y !== 0)) {
      onMoveTable(table, applyDragDelta(table, delta, scale, table.shape));
    }
    // Cleared on a macrotask, not synchronously: the browser fires `click` after
    // dragEnd, and DraggableTable's onActivate consults this ref to tell a real
    // click apart from the tail of a finished drag (5px threshold separates them).
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
