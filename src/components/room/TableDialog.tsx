import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tableInputSchema, type TableInput } from "@/lib/schemas/room";
import { TABLE_SHAPE_LABELS, TABLE_SHAPES, type Room, type RoomTable, type TableShape } from "@/types";

interface TableDialogProps {
  open: boolean;
  table: RoomTable | null;
  rooms: Room[];
  // Used only when creating: the room the owner is currently looking at, the
  // next free number, and a non-overlapping slot on the canvas.
  defaultRoomId: string;
  defaultNumber: number;
  defaultPosition: { pos_x: number; pos_y: number };
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TableInput) => Promise<void>;
}

export function TableDialog({ open, table, rooms, ...rest }: TableDialogProps) {
  const { onOpenChange } = rest;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{table ? `Edytuj stolik ${String(table.number)}` : "Nowy stolik"}</DialogTitle>
          <DialogDescription>
            Numer identyfikuje stolik w obrębie lokalu. Stolika nie można usunąć — nieużywany wyłącz suwakiem „Aktywny”,
            żeby jego kod QR pozostał ważny.
          </DialogDescription>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the form state resets on
            every open without an effect. */}
        <TableForm key={table?.id ?? "new"} table={table} rooms={rooms} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

type TableFormProps = Omit<TableDialogProps, "open">;

function TableForm({
  table,
  rooms,
  defaultRoomId,
  defaultNumber,
  defaultPosition,
  onOpenChange,
  onSubmit,
}: TableFormProps) {
  const [roomId, setRoomId] = useState(table?.room_id ?? defaultRoomId);
  const [number, setNumber] = useState(String(table?.number ?? defaultNumber));
  const [label, setLabel] = useState(table?.label ?? "");
  const [shape, setShape] = useState<TableShape>(table?.shape ?? "square");
  const [isActive, setIsActive] = useState(table?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onDone = () => {
    onOpenChange(false);
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    // An existing table keeps its placement; a new one gets the free slot the
    // manager picked. Dragging (phase 4) is what changes a position afterwards.
    const parsed = tableInputSchema.safeParse({
      room_id: roomId,
      number: Number(number.trim()),
      label,
      shape,
      pos_x: table?.pos_x ?? defaultPosition.pos_x,
      pos_y: table?.pos_y ?? defaultPosition.pos_y,
      is_active: isActive,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
      onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać stolika");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="table-number">Numer stolika</Label>
          <Input
            id="table-number"
            inputMode="numeric"
            value={number}
            onChange={(event) => {
              setNumber(event.target.value);
            }}
            placeholder="np. 12"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="table-shape">Kształt</Label>
          <Select
            value={shape}
            onValueChange={(value) => {
              setShape(value as TableShape);
            }}
          >
            <SelectTrigger id="table-shape" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TABLE_SHAPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TABLE_SHAPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="table-label">Opis (opcjonalnie)</Label>
        <Input
          id="table-label"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          placeholder="np. przy oknie"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="table-room">Sala</Label>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger id="table-room" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rooms.map((room) => (
              <SelectItem key={room.id} value={room.id}>
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm" htmlFor="table-active">
        <Checkbox
          id="table-active"
          checked={isActive}
          onCheckedChange={(checked) => {
            setIsActive(checked === true);
          }}
        />
        Aktywny
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Anuluj
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz"}
        </Button>
      </DialogFooter>
    </form>
  );
}
