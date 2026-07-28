import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { callRoomApi, useRoomLayout } from "@/components/hooks/useRoomLayout";
import type { RoomInput, TableInput } from "@/lib/schemas/room";
import type { Room, RoomTable } from "@/types";
import { RoomCanvas } from "./RoomCanvas";
import { RoomDialog } from "./RoomDialog";
import { RoomTabs } from "./RoomTabs";
import { TableDialog } from "./TableDialog";
import { TableList } from "./TableList";

// A table's full PUT payload, so a single-field change (activation) can reuse
// the same endpoint as the dialog without inventing a partial-update route.
function tableToInput(table: RoomTable): TableInput {
  return {
    room_id: table.room_id,
    number: table.number,
    label: table.label,
    shape: table.shape,
    pos_x: table.pos_x,
    pos_y: table.pos_y,
    is_active: table.is_active,
  };
}

export default function RoomLayoutManager() {
  const { layout, setLayout, loadError, refetch, reload } = useRoomLayout();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // One in-flight position PATCH per table, so a rapid re-drag can supersede its
  // predecessor instead of racing it.
  const positionRequests = useRef(new Map<string, AbortController>());

  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editedRoom, setEditedRoom] = useState<Room | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [editedTable, setEditedTable] = useState<RoomTable | null>(null);
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [busyTableId, setBusyTableId] = useState<string | null>(null);

  // Full-screen error only when there is nothing to show yet (initial load).
  // A failed refetch after a successful mutation surfaces as actionError below.
  if (!layout) {
    if (loadError) {
      return (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-red-100">
          <p>{loadError}</p>
          <Button type="button" variant="outline" className="mt-4" onClick={reload}>
            Spróbuj ponownie
          </Button>
        </div>
      );
    }
    return <p className="text-white/60">Ładowanie schematu sali…</p>;
  }

  // Derived, not stored in an effect: a deleted or never-selected room falls
  // back to the first one, so the view is never pointing at nothing.
  //
  // `.at(0)` rather than `[0]` on purpose: noUncheckedIndexedAccess is off, so
  // `rooms[0]` would type as Room and make every null-guard below look dead to
  // the linter — while an empty rooms array is genuinely reachable (deleting the
  // last, empty room). `.at()` returns Room | undefined, so types match reality.
  const activeRoom = layout.rooms.find((room) => room.id === selectedRoomId) ?? layout.rooms.at(0) ?? null;
  const tablesInRoom = activeRoom ? layout.tables.filter((table) => table.room_id === activeRoom.id) : [];

  // Numbers are unique per COMPANY (FR-010), not per room, so the suggestion
  // looks across every room — otherwise the dialog would pre-fill a 409.
  const nextFreeNumber = layout.tables.reduce((max, table) => Math.max(max, table.number), 0) + 1;

  // Lay new tables out on a simple grid so a room does not stack everything at
  // (0,0) before the owner has dragged anything on the phase-4 canvas.
  const nextFreePosition = () => {
    const index = tablesInRoom.length;
    const perRow = 6;
    return { pos_x: 40 + (index % perRow) * 120, pos_y: 40 + Math.floor(index / perRow) * 120 };
  };

  const openCreateRoom = () => {
    setEditedRoom(null);
    setRoomDialogOpen(true);
  };

  const openEditRoom = (room: Room) => {
    setEditedRoom(room);
    setRoomDialogOpen(true);
  };

  const openCreateTable = () => {
    setEditedTable(null);
    setTableDialogOpen(true);
  };

  const openEditTable = (table: RoomTable) => {
    setEditedTable(table);
    setTableDialogOpen(true);
  };

  // Dialog submits: errors propagate to the dialog, which renders them inline.
  const saveRoom = async (input: RoomInput) => {
    if (editedRoom) {
      await callRoomApi("PUT", `/api/room/rooms/${editedRoom.id}`, input);
    } else {
      const created = await callRoomApi<Room>("POST", "/api/room/rooms", input);
      setSelectedRoomId(created.id);
    }
    await refetch();
  };

  const saveTable = async (input: TableInput) => {
    if (editedTable) {
      await callRoomApi("PUT", `/api/room/tables/${editedTable.id}`, input);
    } else {
      await callRoomApi("POST", "/api/room/tables", input);
    }
    // Follow the table if the dialog moved it to another room.
    setSelectedRoomId(input.room_id);
    await refetch();
  };

  const toggleActive = async (table: RoomTable) => {
    setActionError(null);
    setBusyTableId(table.id);
    try {
      await callRoomApi("PUT", `/api/room/tables/${table.id}`, {
        ...tableToInput(table),
        is_active: !table.is_active,
      });
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Nie udało się zmienić stanu stolika");
    } finally {
      setBusyTableId(null);
    }
  };

  // Optimistic with rollback — the same shape as persistReorder in MenuManager,
  // and the only optimistic mutation here. A drop must feel instant, so the
  // position is applied locally first and reverted if the PATCH fails.
  const persistPosition = async (table: RoomTable, next: { pos_x: number; pos_y: number }) => {
    const previous = layout;
    setLayout({
      ...layout,
      tables: layout.tables.map((candidate) => (candidate.id === table.id ? { ...candidate, ...next } : candidate)),
    });
    setActionError(null);

    positionRequests.current.get(table.id)?.abort();
    const controller = new AbortController();
    positionRequests.current.set(table.id, controller);

    try {
      await callRoomApi("PATCH", `/api/room/tables/${table.id}/position`, next, controller.signal);
    } catch (error) {
      // An abort means a newer drag of the same table replaced this request; its
      // optimistic state is the current truth, so rolling back would undo it.
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setLayout(previous);
      setActionError(error instanceof Error ? error.message : "Nie udało się zapisać pozycji stolika");
    } finally {
      if (positionRequests.current.get(table.id) === controller) {
        positionRequests.current.delete(table.id);
      }
    }
  };

  // A room holding tables cannot be deleted (ON DELETE RESTRICT -> 409); the
  // API's message tells the owner to move the tables first.
  const confirmDeleteRoom = async () => {
    if (!roomToDelete) {
      return;
    }
    setActionError(null);
    try {
      await callRoomApi("DELETE", `/api/room/rooms/${roomToDelete.id}`);
      if (selectedRoomId === roomToDelete.id) {
        setSelectedRoomId(null);
      }
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Nie udało się usunąć sali");
    } finally {
      setRoomToDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      <RoomTabs
        rooms={layout.rooms}
        tables={layout.tables}
        activeRoomId={activeRoom?.id ?? null}
        onSelect={setSelectedRoomId}
        onCreate={openCreateRoom}
        onEdit={openEditRoom}
        onDelete={setRoomToDelete}
      />

      {actionError && (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {actionError}
        </p>
      )}

      {!activeRoom && (
        <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-center">
          <p className="text-white/70">Nie masz jeszcze żadnej sali.</p>
          <Button type="button" className="mt-4" onClick={openCreateRoom}>
            <Plus className="size-4" /> Dodaj pierwszą salę
          </Button>
        </div>
      )}

      {activeRoom && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{activeRoom.name}</h2>
            <Button type="button" onClick={openCreateTable}>
              <Plus className="size-4" /> Dodaj stolik
            </Button>
          </div>

          {tablesInRoom.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-center">
              <p className="text-white/70">W tej sali nie ma jeszcze stolików.</p>
              <Button type="button" className="mt-4" onClick={openCreateTable}>
                <Plus className="size-4" /> Dodaj pierwszy stolik
              </Button>
            </div>
          ) : (
            <>
              <RoomCanvas
                tables={tablesInRoom}
                onOpenTable={openEditTable}
                onMoveTable={(table, next) => void persistPosition(table, next)}
              />
              {/* The canvas is pointer-driven, so the list below stays the
                  keyboard-reachable path to every action — not decoration. */}
              <TableList
                tables={tablesInRoom}
                busyTableId={busyTableId}
                onEdit={openEditTable}
                onToggleActive={(table) => void toggleActive(table)}
              />
            </>
          )}
        </>
      )}

      <RoomDialog open={roomDialogOpen} room={editedRoom} onOpenChange={setRoomDialogOpen} onSubmit={saveRoom} />

      {activeRoom && (
        <TableDialog
          open={tableDialogOpen}
          table={editedTable}
          rooms={layout.rooms}
          defaultRoomId={activeRoom.id}
          defaultNumber={nextFreeNumber}
          defaultPosition={nextFreePosition()}
          onOpenChange={setTableDialogOpen}
          onSubmit={saveTable}
        />
      )}

      <AlertDialog
        open={roomToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoomToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Usunąć salę „${roomToDelete?.name ?? ""}”?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Usunąć można tylko salę bez stolików. Jeśli są w niej stoliki, najpierw przenieś je do innej sali —
              stolików nie usuwamy, żeby ich kody QR pozostały ważne.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteRoom()}>Usuń</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
