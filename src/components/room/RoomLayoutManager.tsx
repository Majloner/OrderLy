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
import { MAX_TABLE_NUMBER, type RoomInput, type TableInput } from "@/lib/schemas/room";
import type { Room, RoomLayoutPayload, RoomTable } from "@/types";
import { RoomCanvas } from "./RoomCanvas";
import { RoomDialog } from "./RoomDialog";
import { RoomTabs } from "./RoomTabs";
import { TableDialog } from "./TableDialog";
import { TableList } from "./TableList";

// Replace one table's coordinates, leaving every other table untouched. Used with
// the functional form of setLayout so concurrent per-table updates cannot clobber
// each other (see persistPosition).
function patchTablePosition(
  payload: RoomLayoutPayload,
  tableId: string,
  position: { pos_x: number; pos_y: number },
): RoomLayoutPayload {
  return {
    ...payload,
    tables: payload.tables.map((candidate) => (candidate.id === tableId ? { ...candidate, ...position } : candidate)),
  };
}

export default function RoomLayoutManager() {
  const { layout, setLayout, loadError, refetch, reload } = useRoomLayout();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // Tail of the serialised PATCH chain per table — see persistPosition.
  const positionQueue = useRef(new Map<string, Promise<void>>());

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

  // Tables whose room does not resolve to a known room. GET /api/room reads rooms
  // and tables as two separate snapshots, so a table moved into a room created
  // between those reads would otherwise render in no tab at all — and since a table
  // can never be deleted, an unreachable row would stay unreachable forever. Mirrors
  // the "Bez kategorii" fallback in MenuManager (impl-review F7).
  const knownRoomIds = new Set(layout.rooms.map((room) => room.id));
  const orphanTables = layout.tables.filter((table) => !knownRoomIds.has(table.room_id));

  // Numbers are unique per COMPANY (FR-010), not per room, so the suggestion looks
  // across every room — otherwise the dialog would pre-fill a 409.
  //
  // Lowest FREE number, not max + 1: numbers are never released (a table cannot be
  // deleted), so max + 1 only ever climbs, and with a table numbered 999 present it
  // would pre-fill 1000 — a value the schema rejects, making "Dodaj stolik" fail on
  // validation every time (impl-review F4).
  const nextFreeNumber = (() => {
    const used = new Set(layout.tables.map((table) => table.number));
    for (let candidate = 1; candidate <= MAX_TABLE_NUMBER; candidate += 1) {
      if (!used.has(candidate)) {
        return candidate;
      }
    }
    // Every number taken: fall back to the ceiling and let the 409 explain itself.
    return MAX_TABLE_NUMBER;
  })();

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

  // Single-field PATCH, not a full PUT: rewriting all seven columns from client
  // state lets a stale tab silently revert a drag or rename made elsewhere
  // (impl-review F5).
  const toggleActive = async (table: RoomTable) => {
    setActionError(null);
    setBusyTableId(table.id);
    try {
      await callRoomApi("PATCH", `/api/room/tables/${table.id}/activation`, {
        is_active: !table.is_active,
      });
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Nie udało się zmienić stanu stolika");
    } finally {
      setBusyTableId(null);
    }
  };

  // Optimistic with rollback — the only optimistic mutation here. A drop must feel
  // instant, so the position is applied locally first.
  //
  // Two things this deliberately does NOT do, both learned the hard way:
  //
  // 1. It never restores a whole-layout snapshot. Reverting `{...layout}` captured
  //    at call time would discard writes to OTHER tables that committed while this
  //    request was in flight — a failed drag of table A would visibly undo table
  //    B's already-saved move. Every update is functional and touches one table.
  //
  // 2. It does not abort superseded requests. abort() only closes the client
  //    connection; a request the Worker already forwarded still commits, so an
  //    older position could land in Postgres LAST while the UI shows the newer one
  //    — silently, since the aborted response never arrives. Chaining per table
  //    makes commit order equal send order, which is what actually fixes it, and
  //    lets the server's returned row be authoritative.
  const persistPosition = (table: RoomTable, next: { pos_x: number; pos_y: number }) => {
    const before = { pos_x: table.pos_x, pos_y: table.pos_y };

    setLayout((prev) => (prev === null ? prev : patchTablePosition(prev, table.id, next)));
    setActionError(null);

    const tail = positionQueue.current.get(table.id) ?? Promise.resolve();
    const run = tail
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await callRoomApi<RoomTable>("PATCH", `/api/room/tables/${table.id}/position`, next);
          // The server clamps, so its answer can differ from what we guessed.
          setLayout((prev) =>
            prev === null ? prev : patchTablePosition(prev, table.id, { pos_x: saved.pos_x, pos_y: saved.pos_y }),
          );
        } catch (error) {
          setLayout((prev) => (prev === null ? prev : patchTablePosition(prev, table.id, before)));
          setActionError(error instanceof Error ? error.message : "Nie udało się zapisać pozycji stolika");
        }
      });

    positionQueue.current.set(table.id, run);
    void run.finally(() => {
      if (positionQueue.current.get(table.id) === run) {
        positionQueue.current.delete(table.id);
      }
    });
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
              <RoomCanvas tables={tablesInRoom} onOpenTable={openEditTable} onMoveTable={persistPosition} />
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

      {orphanTables.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-400/30 bg-amber-500/5 p-4">
          <h2 className="text-lg font-semibold">Bez sali</h2>
          <p className="text-sm text-white/60">
            Te stoliki wskazują salę, której już nie ma. Otwórz stolik i przypisz go do istniejącej sali.
          </p>
          <TableList
            tables={orphanTables}
            busyTableId={busyTableId}
            onEdit={openEditTable}
            onToggleActive={(table) => void toggleActive(table)}
          />
        </div>
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
