import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROOM_OBJECT_KIND_LABELS, type RoomObject } from "@/types";
import { ROOM_OBJECT_ICONS } from "./room-object-visuals";

interface RoomObjectListProps {
  objects: RoomObject[];
  busyObjectId: string | null;
  onEdit: (object: RoomObject) => void;
  onDelete: (object: RoomObject) => void;
}

// Keyboard-reachable path to every object action. The canvas is pointer-driven, so
// this list is the accessible route, not decoration — same reasoning as TableList.
// Unlike TableList it DOES offer delete, because an object has no QR code to keep
// valid.
export function RoomObjectList({ objects, busyObjectId, onEdit, onDelete }: RoomObjectListProps) {
  return (
    <ul className="space-y-2">
      {objects.map((object) => {
        const Icon = ROOM_OBJECT_ICONS[object.kind];
        const kindLabel = ROOM_OBJECT_KIND_LABELS[object.kind];

        return (
          <li
            key={object.id}
            className="border-border bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2"
          >
            <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{object.label ?? kindLabel}</span>
              <span className="text-muted-foreground block text-xs">
                {kindLabel} · {object.width}×{object.height}
                {object.rotation === 0 ? "" : ` · ${String(object.rotation)}°`}
              </span>
            </span>
            <span className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Edytuj: ${kindLabel}`}
                onClick={() => {
                  onEdit(object);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyObjectId === object.id}
                aria-label={`Usuń: ${kindLabel}`}
                onClick={() => {
                  onDelete(object);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
