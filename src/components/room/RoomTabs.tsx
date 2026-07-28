import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Room, RoomTable } from "@/types";

interface RoomTabsProps {
  rooms: Room[];
  tables: RoomTable[];
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
  onCreate: () => void;
  onEdit: (room: Room) => void;
  onDelete: (room: Room) => void;
}

export function RoomTabs({ rooms, tables, activeRoomId, onSelect, onCreate, onEdit, onDelete }: RoomTabsProps) {
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? null;
  const countFor = (roomId: string) => tables.filter((table) => table.room_id === roomId).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sale">
        {rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            role="tab"
            aria-selected={room.id === activeRoomId}
            onClick={() => {
              onSelect(room.id);
            }}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              room.id === activeRoomId
                ? "border-purple-400/50 bg-purple-500/20 text-white"
                : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10",
            )}
          >
            {room.name}
            <span className="ml-2 text-xs text-white/50">{countFor(room.id)}</span>
          </button>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={onCreate}>
        <Plus className="size-4" /> Dodaj salę
      </Button>

      {/* Rename/delete act on the room currently in view, so the tab strip stays
          a strip rather than growing a control cluster per tab. */}
      {activeRoom && (
        <span className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Zmień nazwę sali ${activeRoom.name}`}
            onClick={() => {
              onEdit(activeRoom);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Usuń salę ${activeRoom.name}`}
            onClick={() => {
              onDelete(activeRoom);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </span>
      )}
    </div>
  );
}
