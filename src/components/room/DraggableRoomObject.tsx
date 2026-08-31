import { useEffect, useRef, useState } from "react";
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
  // pointerId is part of the gesture, not decoration: on a touch screen a second
  // finger produces its own pointermove stream over the same handle, and without
  // this the two would fight over one startX/startY.
  const gestureRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  // A draft SHADOWS the prop (see `shown` below), so one left behind survives even a
  // refetch and pins the object at a size nobody saved. Drop it if this unmounts
  // mid-gesture — a room switch or a concurrent delete can do that.
  useEffect(() => {
    return () => {
      gestureRef.current = null;
    };
  }, []);

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
    gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  };

  // Also wired to onLostPointerCapture. The browser releases capture silently when a
  // capturing element leaves the document, WITHOUT firing pointerup — so without this
  // an interrupted gesture would leave gestureRef armed, and since onPointerMove fires
  // on plain hover, merely passing the mouse over a handle would then resize the object
  // against a dead origin.
  const endGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (gestureRef.current && gestureRef.current.pointerId !== event.pointerId) {
      return;
    }
    gestureRef.current = null;
    if (draft) {
      onTransform(draft);
      setDraft(null);
    }
  };

  // Shared entry check for both move handlers: a gesture must be armed, and the event
  // must belong to the pointer that armed it.
  const gestureStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = gestureRef.current;
    if (start?.pointerId !== event.pointerId) {
      return null;
    }
    return start;
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    const start = gestureStart(event);
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
    if (!gestureStart(event)) {
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
      // Hold the angle we are already showing when the pointer crosses the centre,
      // instead of collapsing to upright and committing that.
      shown.rotation,
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

      {/* HIDDEN during a body drag rather than unmounted. Unmounting a capturing
          element releases its pointer capture without firing pointerup, which is how a
          two-finger touch (one on a handle, one dragging the body) used to strand a
          gesture. Kept in the tree, the handle still receives its own pointerup. */}
      {selected && (
        <div className={cn("contents", isDragging && "invisible")} aria-hidden={isDragging}>
          {CORNERS.map(({ handle, label: cornerLabel, className }) => (
            <button
              key={cornerLabel}
              type="button"
              // Not a keyboard target: these do nothing without a pointer, and the
              // dialog is the documented keyboard path for size and rotation.
              tabIndex={-1}
              aria-label={`Zmień rozmiar: ${cornerLabel} narożnik`}
              className={cn(
                "border-primary bg-card absolute size-3 touch-none rounded-sm border",
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
              onLostPointerCapture={endGesture}
            />
          ))}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Obróć element"
            className="border-primary bg-info-fill absolute top-0 left-1/2 size-3 translate-x-[-50%] translate-y-[-200%] touch-none rounded-full border"
            onPointerDown={beginGesture}
            onPointerMove={handleRotateMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
          />
        </div>
      )}
    </div>
  );
}
