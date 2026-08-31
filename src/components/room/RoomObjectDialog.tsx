import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { ROOM_OBJECT_DEFAULT_SIZES } from "@/lib/room-geometry";
import { roomObjectInputSchema, type RoomObjectInput } from "@/lib/schemas/room";
import { ROOM_OBJECT_KIND_LABELS, ROOM_OBJECT_KINDS, type Room, type RoomObject, type RoomObjectKind } from "@/types";

interface RoomObjectDialogProps {
  open: boolean;
  object: RoomObject | null;
  rooms: Room[];
  // Used only when creating: the room the owner is looking at and a free slot.
  defaultRoomId: string;
  defaultPosition: { pos_x: number; pos_y: number };
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: RoomObjectInput) => Promise<void>;
  onDelete: (object: RoomObject) => void;
}

export function RoomObjectDialog({ open, object, rooms, ...rest }: RoomObjectDialogProps) {
  const { onOpenChange } = rest;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {object ? `Edytuj: ${ROOM_OBJECT_KIND_LABELS[object.kind]}` : "Nowy element wyposażenia"}
          </DialogTitle>
          <DialogDescription>
            Rozmiar i obrót ustawiasz tutaj; pozycję zmieniasz przeciągając element na planie. Elementy wyposażenia
            można usuwać — w odróżnieniu od stolików nie mają przypisanego kodu QR.
          </DialogDescription>
        </DialogHeader>
        {/* Radix unmounts the content on close, so form state resets on every open
            without an effect. */}
        <RoomObjectForm key={object?.id ?? "new"} object={object} rooms={rooms} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

type RoomObjectFormProps = Omit<RoomObjectDialogProps, "open">;

function RoomObjectForm({
  object,
  rooms,
  defaultRoomId,
  defaultPosition,
  onOpenChange,
  onSubmit,
  onDelete,
}: RoomObjectFormProps) {
  const initialKind: RoomObjectKind = object?.kind ?? "wall";
  const initialSize = ROOM_OBJECT_DEFAULT_SIZES[initialKind];

  const [roomId, setRoomId] = useState(object?.room_id ?? defaultRoomId);
  const [kind, setKind] = useState<RoomObjectKind>(initialKind);
  const [label, setLabel] = useState(object?.label ?? "");
  const [width, setWidth] = useState(String(object?.width ?? initialSize.width));
  const [height, setHeight] = useState(String(object?.height ?? initialSize.height));
  const [rotation, setRotation] = useState(String(object?.rotation ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onDone = () => {
    onOpenChange(false);
  };

  // Changing the kind of a NEW object re-seeds its dimensions, so picking "ściana"
  // immediately yields a long thin rectangle instead of whatever the previous kind
  // measured. An existing object keeps the size the owner already gave it.
  const handleKindChange = (value: string) => {
    const nextKind = value as RoomObjectKind;
    setKind(nextKind);
    if (!object) {
      const size = ROOM_OBJECT_DEFAULT_SIZES[nextKind];
      setWidth(String(size.width));
      setHeight(String(size.height));
    }
  };

  // Quarter turns are the common case by far — typing "90" for a vertical wall is
  // the kind of friction that makes people give up on the feature.
  const rotateQuarter = () => {
    const current = Number(rotation.trim());
    const base = Number.isFinite(current) ? current : 0;
    setRotation(String((((base + 90) % 360) + 360) % 360));
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = roomObjectInputSchema.safeParse({
      room_id: roomId,
      kind,
      label,
      // An existing object keeps its placement; a new one takes the free slot the
      // manager picked. Dragging is what moves it afterwards.
      pos_x: object?.pos_x ?? defaultPosition.pos_x,
      pos_y: object?.pos_y ?? defaultPosition.pos_y,
      width: Number(width.trim()),
      height: Number(height.trim()),
      rotation: Number(rotation.trim()),
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
      setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać elementu");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="object-kind">Rodzaj</Label>
        <Select value={kind} onValueChange={handleKindChange}>
          <SelectTrigger id="object-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROOM_OBJECT_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {ROOM_OBJECT_KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="object-width">Szerokość</Label>
          {/* inputMode rather than type="number" with min/max, matching TableDialog.
              Native constraint validation would block submit with a browser bubble
              before handleSubmit runs, making the Polish messages in schemas/room.ts
              unreachable for exactly the values they were written for. zod stays the
              single validation authority. */}
          <Input
            id="object-width"
            inputMode="numeric"
            value={width}
            onChange={(event) => {
              setWidth(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="object-height">Wysokość</Label>
          <Input
            id="object-height"
            inputMode="numeric"
            value={height}
            onChange={(event) => {
              setHeight(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="object-rotation">Obrót (stopnie)</Label>
        <div className="flex gap-2">
          <Input
            id="object-rotation"
            inputMode="numeric"
            value={rotation}
            onChange={(event) => {
              setRotation(event.target.value);
            }}
          />
          <Button type="button" variant="outline" onClick={rotateQuarter}>
            <RotateCw className="size-4" /> +90°
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="object-label">Opis (opcjonalnie)</Label>
        <Input
          id="object-label"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          placeholder="np. ściana od kuchni"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="object-room">Sala</Label>
        <Select value={roomId} onValueChange={setRoomId}>
          <SelectTrigger id="object-room" className="w-full">
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

      {error && <p className="text-destructive text-sm">{error}</p>}
      <DialogFooter className="sm:justify-between">
        {object ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onDone();
              onDelete(object);
            }}
          >
            Usuń
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Anuluj
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </span>
      </DialogFooter>
    </form>
  );
}
