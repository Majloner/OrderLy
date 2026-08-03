import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { applyResizeDelta, applyRotateDelta, type ResizeHandle } from "@/lib/room-geometry";
import { cn } from "@/lib/utils";
import { ROOM_OBJECT_KIND_LABELS, type RoomObject } from "@/types";
import { ROOM_OBJECT_ICONS, ROOM_OBJECT_STYLES } from "./room-object-visuals";

export interface RoomObjectTransform {
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  rotation: number;
}

interface DraggableRoomObjectProps {
  object: RoomObject;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onTransform: (next: RoomObjectTransform) => void;
}

const CORNERS: { handle: ResizeHandle; label: string; className: string }[] = [
  { handle: { x: -1, y: -1 }, label: "lewy górny", className: "left-0 top-0 cursor-nwse-resize" },
  { handle: { x: 1, y: -1 }, label: "prawy górny", className: "right-0 top-0 cursor-nesw-resize" },
  { handle: { x: -1, y: 1 }, label: "lewy dolny", className: "bottom-0 left-0 cursor-nesw-resize" },
  { handle: { x: 1, y: 1 }, label: "prawy dolny", className: "bottom-0 right-0 cursor-nwse-resize" },
];

// Snap while Shift is held, exactly like the resize-free-angle convention in most
// editors. 15° keeps the common angles (30/45/60) reachable.
const SNAP_DEGREES = 15;

export function DraggableRoomObject({
  object,
  scale,
  selected,
  onSelect,
  onOpen,
  onTransform,
}: DraggableRoomObjectProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: object.id,
    data: { entity: "object" },
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  // Live preview while a handle gesture is in flight. The row itself is only
  // written on pointerup, so a gesture costs exactly one request.
  const [draft, setDraft] = useState<RoomObjectTransform | null>(null);
  const gestureRef = useRef<{ startX: number; startY: number } | null>(null);

  const shown: RoomObjectTransform = draft ?? object;
  const Icon = ROOM_OBJECT_ICONS[object.kind];
  const width = shown.width * scale;
  const height = shown.height * scale;
  const iconSize = Math.max(8, Math.min(28, Math.min(width, height) * 0.7));

  const label = [
    ROOM_OBJECT_KIND_LABELS[object.kind],
    object.label,
    `${String(object.width)}×${String(object.height)}`,
    object.rotation === 0 ? null : `obrót ${String(object.rotation)}°`,
  ]
    .filter(Boolean)
    .join(", ");

  // Shared by both handle kinds. stopPropagation is the load-bearing part: without
  // it the canvas PointerSensor treats the press as the start of a MOVE and the
  // object slides away instead of resizing.
  const beginGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { startX: event.clientX, startY: event.clientY };
  };

  const endGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    gestureRef.current = null;
    if (draft) {
      onTransform(draft);
      setDraft(null);
    }
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    const start = gestureRef.current;
    if (!start) {
      return;
    }
    event.stopPropagation();
    const resized = applyResizeDelta(
      object,
      { width: object.width, height: object.height },
      object.rotation,
      handle,
      { x: event.clientX - start.startX, y: event.clientY - start.startY },
      scale,
    );
    setDraft({ ...resized, rotation: object.rotation });
  };

  const handleRotateMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!gestureRef.current) {
      return;
    }
    event.stopPropagation();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    // The element's box is the ROTATED bounding box, but its centre is the object's
    // centre regardless of angle, so this stays stable mid-gesture.
    const offsetX = event.clientX - (rect.left + rect.width / 2);
    const offsetY = event.clientY - (rect.top + rect.height / 2);
    // An angle is scale-invariant, so the centre/scale arguments collapse to the
    // origin and 1 — the offset alone carries the bearing.
    const rotation = applyRotateDelta(
      { pos_x: 0, pos_y: 0 },
      { x: offsetX, y: offsetY },
      1,
      event.shiftKey ? SNAP_DEGREES : 0,
    );
    setDraft({ pos_x: object.pos_x, pos_y: object.pos_y, width: object.width, height: object.height, rotation });
  };

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        setNodeRef(node);
      }}
      className={cn(
        "absolute",
        // Objects sit UNDER tables (z-20/z-30) at every moment. A selected one is
        // lifted above its unselected siblings so its handles stay reachable.
        isDragging ? "z-10" : selected ? "z-[5]" : "z-0",
      )}
      style={{
        // pos_* is the CENTRE (see src/lib/room-geometry.ts).
        left: shown.pos_x * scale - width / 2,
        top: shown.pos_y * scale - height / 2,
        width,
        height,
        // ORDER MATTERS: rotate in the element's own frame, THEN translate in the
        // parent's. Reversed, the drag vector gets rotated too and the object arcs
        // away from the pointer in proportion to the angle.
        transform: [CSS.Translate.toString(transform), `rotate(${String(shown.rotation)}deg)`]
          .filter(Boolean)
          .join(" "),
      }}
    >
      {/* The drag surface is a separate element from the root so the handles can be
          siblings rather than children of an interactive node — a button inside a
          button is invalid, and nesting is what forced this split. dnd-kit's
          `attributes` already supply role="button" and tabIndex. */}
      <div
        {...attributes}
        {...listeners}
        aria-label={label}
        onClick={() => {
          // First click selects, a second one opens the dialog. Selection has to
          // come first or there would be no way to reach the handles by pointer.
          if (selected) {
            onOpen();
          } else {
            onSelect();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          // touch-none is load-bearing: without it a mobile browser scrolls the
          // page and PointerSensor never receives the move events.
          "flex size-full touch-none items-center justify-center overflow-hidden rounded-md border transition-colors",
          ROOM_OBJECT_STYLES[object.kind],
          selected && "ring-2 ring-white/60",
          isDragging ? "cursor-grabbing opacity-80" : "cursor-grab",
        )}
      >
        <Icon style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
      </div>

      {selected && !isDragging && (
        <>
          {CORNERS.map(({ handle, label: cornerLabel, className }) => (
            <button
              key={cornerLabel}
              type="button"
              aria-label={`Zmień rozmiar: ${cornerLabel} narożnik`}
              className={cn(
                "absolute size-3 touch-none rounded-sm border border-white/80 bg-white/90",
                // Centred on the corner rather than tucked inside it, so the whole
                // hit area is usable even on a 20px-thin wall.
                "translate-x-[-50%] translate-y-[-50%]",
                className,
              )}
              onPointerDown={beginGesture}
              onPointerMove={(event) => {
                handleResizeMove(event, handle);
              }}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            />
          ))}
          <button
            type="button"
            aria-label="Obróć element"
            className="absolute top-0 left-1/2 size-3 translate-x-[-50%] translate-y-[-200%] touch-none rounded-full border border-white/80 bg-sky-300/90"
            onPointerDown={beginGesture}
            onPointerMove={handleRotateMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          />
        </>
      )}
    </div>
  );
}
