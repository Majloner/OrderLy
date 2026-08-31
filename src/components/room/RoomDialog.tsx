import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roomInputSchema, type RoomInput } from "@/lib/schemas/room";
import type { Room } from "@/types";

interface RoomDialogProps {
  open: boolean;
  room: Room | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: RoomInput) => Promise<void>;
}

export function RoomDialog({ open, room, onOpenChange, onSubmit }: RoomDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? "Edytuj salę" : "Nowa sala"}</DialogTitle>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the form state resets on
            every open without an effect. */}
        <RoomForm
          room={room}
          onSubmit={onSubmit}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface RoomFormProps {
  room: Room | null;
  onSubmit: (input: RoomInput) => Promise<void>;
  onDone: () => void;
}

function RoomForm({ room, onSubmit, onDone }: RoomFormProps) {
  const [name, setName] = useState(room?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = roomInputSchema.safeParse({ name });
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
      setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać sali");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="room-name">Nazwa sali</Label>
        <Input
          id="room-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="np. Taras"
          autoFocus
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
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
