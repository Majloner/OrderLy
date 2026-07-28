import { z } from "zod";
import { LOGICAL_CANVAS, OBJECT_SIZE_BOUNDS } from "@/lib/room-geometry";
import { ROOM_OBJECT_KINDS, TABLE_SHAPES } from "@/types";

// Coordinates are bounded by the logical canvas, not by the shape footprint:
// the exact in-bounds maximum depends on the shape, and the server clamps
// (clampPosition) instead of rejecting, so dragging to an edge snaps.
const posXSchema = z
  .number("Pozycja X musi być liczbą")
  .int("Pozycja X musi być liczbą całkowitą")
  .min(0, "Pozycja X nie może być ujemna")
  .max(LOGICAL_CANVAS.width, "Pozycja X wykracza poza plan sali");

const posYSchema = z
  .number("Pozycja Y musi być liczbą")
  .int("Pozycja Y musi być liczbą całkowitą")
  .min(0, "Pozycja Y nie może być ujemna")
  .max(LOGICAL_CANVAS.height, "Pozycja Y wykracza poza plan sali");

// Single source of truth for the table-number ceiling: the zod bound, the UI's
// next-free-number suggestion and the DB check constraint must agree, or a row can
// exist that no UI path is able to save (impl-review F4).
export const MAX_TABLE_NUMBER = 999;

export const roomInputSchema = z.object({
  name: z
    .string("Nazwa sali jest wymagana")
    .trim()
    .min(1, "Nazwa sali jest wymagana")
    .max(60, "Nazwa sali może mieć najwyżej 60 znaków"),
});

export const tableInputSchema = z.object({
  room_id: z.uuid("Nieprawidłowy identyfikator sali"),
  number: z
    .number("Numer stolika musi być liczbą")
    .int("Numer stolika musi być liczbą całkowitą")
    .min(1, "Numer stolika musi być większy od zera")
    .max(MAX_TABLE_NUMBER, "Numer stolika może mieć najwyżej trzy cyfry"),
  label: z
    .string("Opis musi być tekstem")
    .trim()
    .max(80, "Opis może mieć najwyżej 80 znaków")
    .nullish()
    .transform((value) => {
      if (!value) {
        return null;
      }
      return value;
    }),
  shape: z.enum(TABLE_SHAPES, "Nieprawidłowy kształt stolika"),
  pos_x: posXSchema,
  pos_y: posYSchema,
  is_active: z.boolean("Dostępność stolika musi być wartością logiczną"),
});

// Minimal payload for the canvas drag hot path — a drop should not have to
// re-send (and re-validate) the whole table.
export const tablePositionSchema = z.object({
  pos_x: posXSchema,
  pos_y: posYSchema,
});

// Same reasoning as the position payload: a one-field change must not rewrite the
// other six columns from possibly-stale client state, or a second tab's toggle
// silently reverts a drag or rename made elsewhere (impl-review F5).
export const tableActivationSchema = z.object({
  is_active: z.boolean("Dostępność stolika musi być wartością logiczną"),
});

// Rotation is stored as whole degrees in [0, 359]. Exported for the same reason as
// MAX_TABLE_NUMBER: the zod bound, the number input's max and the DB check
// constraint have to agree, and 360 must be the wrap point rather than a value.
export const MAX_ROTATION_DEGREES = 359;

export const roomObjectInputSchema = z.object({
  room_id: z.uuid("Nieprawidłowy identyfikator sali"),
  kind: z.enum(ROOM_OBJECT_KINDS, "Nieprawidłowy rodzaj obiektu"),
  label: z
    .string("Opis musi być tekstem")
    .trim()
    .max(80, "Opis może mieć najwyżej 80 znaków")
    .nullish()
    .transform((value) => {
      if (!value) {
        return null;
      }
      return value;
    }),
  // The object's CENTRE, so it shares the table coordinate bounds exactly — see
  // the centre-anchoring rationale in src/lib/room-geometry.ts.
  pos_x: posXSchema,
  pos_y: posYSchema,
  width: z
    .number("Szerokość musi być liczbą")
    .int("Szerokość musi być liczbą całkowitą")
    .min(OBJECT_SIZE_BOUNDS.minWidth, `Szerokość musi wynosić co najmniej ${String(OBJECT_SIZE_BOUNDS.minWidth)} px`)
    .max(OBJECT_SIZE_BOUNDS.maxWidth, "Szerokość wykracza poza plan sali"),
  height: z
    .number("Wysokość musi być liczbą")
    .int("Wysokość musi być liczbą całkowitą")
    .min(OBJECT_SIZE_BOUNDS.minHeight, `Wysokość musi wynosić co najmniej ${String(OBJECT_SIZE_BOUNDS.minHeight)} px`)
    .max(OBJECT_SIZE_BOUNDS.maxHeight, "Wysokość wykracza poza plan sali"),
  rotation: z
    .number("Obrót musi być liczbą")
    .int("Obrót musi być liczbą całkowitą stopni")
    .min(0, "Obrót nie może być ujemny")
    .max(MAX_ROTATION_DEGREES, "Obrót musi być mniejszy niż 360 stopni"),
});

// Drag hot path for objects, mirroring tablePositionSchema: a drop must not
// re-send the size and rotation it did not change.
export const roomObjectPositionSchema = z.object({
  pos_x: posXSchema,
  pos_y: posYSchema,
});

export type RoomInput = z.output<typeof roomInputSchema>;
export type TableInput = z.output<typeof tableInputSchema>;
export type TablePositionInput = z.output<typeof tablePositionSchema>;
export type TableActivationInput = z.output<typeof tableActivationSchema>;
export type RoomObjectInput = z.output<typeof roomObjectInputSchema>;
export type RoomObjectPositionInput = z.output<typeof roomObjectPositionSchema>;
