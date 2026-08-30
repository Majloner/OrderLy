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
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { callRoomApi, useRoomLayout } from "@/components/hooks/useRoomLayout";
import { MAX_TABLE_NUMBER, type RoomInput, type RoomObjectInput, type TableInput } from "@/lib/schemas/room";
import { ROOM_OBJECT_KIND_LABELS, type Room, type RoomLayoutPayload, type RoomObject, type RoomTable } from "@/types";
import type { RoomObjectTransform } from "./DraggableRoomObject";
import { RoomCanvas } from "./RoomCanvas";
import { RoomDialog } from "./RoomDialog";
import { RoomObjectDialog } from "./RoomObjectDialog";
import { RoomObjectList } from "./RoomObjectList";
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

// The room_objects counterpart of patchTablePosition, for the same reason: one
// object's fields change and nothing else does. Takes a partial so a drag (position
// only) and a handle gesture (position + size + rotation) share one path.
function patchObject(payload: RoomLayoutPayload, objectId: string, fields: Partial<RoomObject>): RoomLayoutPayload {
  return {
    ...payload,
    objects: payload.objects.map((candidate) => (candidate.id === objectId ? { ...candidate, ...fields } : candidate)),
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
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
  const [editedObject, setEditedObject] = useState<RoomObject | null>(null);
  const [objectToDelete, setObjectToDelete] = useState<RoomObject | null>(null);
  const [busyObjectId, setBusyObjectId] = useState<string | null>(null);
  // Separate queue from positionQueue: an object and a table can hold the same
  // position in the map only by id, and mixing the two would let a table's chain
  // block an object's for no reason.
  const objectPositionQueue = useRef(new Map<string, Promise<void>>());

  // Full-screen error only when there is nothing to show yet (initial load).
  // A failed refetch after a successful mutation surfaces as actionError below.
  if (!layout) {
    if (loadError) {
      return <ErrorPanel message={loadError} onRetry={reload} />;
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
  const objectsInRoom = activeRoom ? layout.objects.filter((object) => object.room_id === activeRoom.id) : [];

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

  // Same idea for objects, but these coordinates are the CENTRE, so the grid starts
  // half a default footprint in rather than at the corner.
  const nextFreeObjectPosition = () => {
    const index = objectsInRoom.length;
    const perRow = 5;
    return { pos_x: 220 + (index % perRow) * 180, pos_y: 150 + Math.floor(index / perRow) * 150 };
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

  const openCreateObject = () => {
    setEditedObject(null);
    setObjectDialogOpen(true);
  };

  const openEditObject = (object: RoomObject) => {
    setEditedObject(object);
    setObjectDialogOpen(true);
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

  const saveObject = async (input: RoomObjectInput) => {
    if (editedObject) {
      await callRoomApi("PUT", `/api/room/objects/${editedObject.id}`, input);
    } else {
      await callRoomApi("POST", "/api/room/objects", input);
    }
    // Follow the object if the dialog moved it to another room.
    setSelectedRoomId(input.room_id);
    await refetch();
  };

  // The delete path public.tables deliberately has no equivalent of: an object is
  // not tied to a printed QR code, so removing one costs nothing permanent.
  const confirmDeleteObject = async () => {
    if (!objectToDelete) {
      return;
    }
    setActionError(null);
    setBusyObjectId(objectToDelete.id);
    try {
      await callRoomApi("DELETE", `/api/room/objects/${objectToDelete.id}`);
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Nie udało się usunąć elementu");
    } finally {
      setBusyObjectId(null);
      setObjectToDelete(null);
    }
  };

  // Mirrors persistPosition exactly, including both of the lessons recorded there:
  // a functional per-object patch instead of a whole-layout snapshot, and a
  // serialised chain per id instead of aborting superseded requests. Adding a third
  // collection to the payload is precisely what would have made a snapshot rollback
  // worse — it would now discard concurrent writes to tables as well.
  const persistObjectPosition = (object: RoomObject, next: { pos_x: number; pos_y: number }) => {
    setLayout((prev) => (prev === null ? prev : patchObject(prev, object.id, next)));
    setActionError(null);

    const tail = objectPositionQueue.current.get(object.id) ?? Promise.resolve();
    const run = tail
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await callRoomApi<RoomObject>("PATCH", `/api/room/objects/${object.id}/position`, next);
          // The server clamps against the ROTATED bounding box, so its answer can
          // differ from the client's guess by more than rounding.
          setLayout((prev) =>
            prev === null ? prev : patchObject(prev, object.id, { pos_x: saved.pos_x, pos_y: saved.pos_y }),
          );
        } catch (error) {
          setActionError(error instanceof Error ? error.message : "Nie udało się zapisać pozycji elementu");
          // Resync instead of restoring a remembered value. Any "before" a client can
          // hold is itself optimistic once a second gesture is queued behind the first:
          // if drag A (P0->P1) and drag B (P1->P2) both fail, A rolls back to P0 and B
          // then rolls FORWARD to P1 — a position the server never accepted, under a
          // banner saying the save failed. The server is the only thing that knows.
          // If the refetch fails too we are offline; the banner already says so and the
          // canvas keeps the optimistic value, which is no worse than a wrong rollback.
          await refetch().catch(() => undefined);
        }
      });

    objectPositionQueue.current.set(object.id, run);
    void run.finally(() => {
      if (objectPositionQueue.current.get(object.id) === run) {
        objectPositionQueue.current.delete(object.id);
      }
    });
  };

  // End of a resize or rotate gesture. Goes through the transform PATCH rather than a
  // full PUT: geometry is all that changed, so room_id, kind and label are never in the
  // body and a rename or room move that lands while this sits in the queue cannot be
  // reverted by it. Shares persistObjectPosition's queue so a gesture and a drag of the
  // SAME object still commit in send order.
  const persistObjectTransform = (object: RoomObject, next: RoomObjectTransform) => {
    setLayout((prev) => (prev === null ? prev : patchObject(prev, object.id, next)));
    setActionError(null);

    const tail = objectPositionQueue.current.get(object.id) ?? Promise.resolve();
    const run = tail
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await callRoomApi<RoomObject>("PATCH", `/api/room/objects/${object.id}/transform`, next);
          setLayout((prev) =>
            prev === null
              ? prev
              : patchObject(prev, object.id, {
                  pos_x: saved.pos_x,
                  pos_y: saved.pos_y,
                  width: saved.width,
                  height: saved.height,
                  rotation: saved.rotation,
                }),
          );
        } catch (error) {
          setActionError(error instanceof Error ? error.message : "Nie udało się zapisać elementu");
          // Resync rather than restore — see the note in persistObjectPosition.
          await refetch().catch(() => undefined);
        }
      });

    objectPositionQueue.current.set(object.id, run);
    void run.finally(() => {
      if (objectPositionQueue.current.get(object.id) === run) {
        objectPositionQueue.current.delete(object.id);
      }
    });
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

      {actionError && <ErrorPanel message={actionError} />}

      {!activeRoom && (
        <EmptyState message="Nie masz jeszcze żadnej sali.">
          <Button type="button" className="mt-4" onClick={openCreateRoom}>
            <Plus className="size-4" /> Dodaj pierwszą salę
          </Button>
        </EmptyState>
      )}

      {activeRoom && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{activeRoom.name}</h2>
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={openCreateObject}>
                <Plus className="size-4" /> Dodaj obiekt
              </Button>
              <Button type="button" onClick={openCreateTable}>
                <Plus className="size-4" /> Dodaj stolik
              </Button>
            </span>
          </div>

          {tablesInRoom.length === 0 && objectsInRoom.length === 0 ? (
            <EmptyState message="W tej sali nie ma jeszcze stolików ani wyposażenia.">
              <Button type="button" className="mt-4" onClick={openCreateTable}>
                <Plus className="size-4" /> Dodaj pierwszy stolik
              </Button>
            </EmptyState>
          ) : (
            <>
              <RoomCanvas
                tables={tablesInRoom}
                objects={objectsInRoom}
                onOpenTable={openEditTable}
                onMoveTable={persistPosition}
                onOpenObject={openEditObject}
                onMoveObject={persistObjectPosition}
                onTransformObject={persistObjectTransform}
              />
              {/* The canvas is pointer-driven, so the lists below stay the
                  keyboard-reachable path to every action — not decoration. */}
              {tablesInRoom.length > 0 && (
                <TableList
                  tables={tablesInRoom}
                  busyTableId={busyTableId}
                  onEdit={openEditTable}
                  onToggleActive={(table) => void toggleActive(table)}
                />
              )}
              {objectsInRoom.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white/70">Wyposażenie</h3>
                  <RoomObjectList
                    objects={objectsInRoom}
                    busyObjectId={busyObjectId}
                    onEdit={openEditObject}
                    onDelete={setObjectToDelete}
                  />
                </div>
              )}
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

      {activeRoom && (
        <RoomObjectDialog
          open={objectDialogOpen}
          object={editedObject}
          rooms={layout.rooms}
          defaultRoomId={activeRoom.id}
          defaultPosition={nextFreeObjectPosition()}
          onOpenChange={setObjectDialogOpen}
          onSubmit={saveObject}
          onDelete={setObjectToDelete}
        />
      )}

      <AlertDialog
        open={objectToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setObjectToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`Usunąć: ${objectToDelete === null ? "" : ROOM_OBJECT_KIND_LABELS[objectToDelete.kind]}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Elementu nie da się przywrócić — trzeba go dodać i wymiarować od nowa. Stoliki tego nie dotyczy: ich się
              nie usuwa, tylko wyłącza.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteObject()}>Usuń</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
