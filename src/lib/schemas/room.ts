import { z } from "zod";
import { LOGICAL_CANVAS } from "@/lib/room-geometry";
import { TABLE_SHAPES } from "@/types";

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
    .max(999, "Numer stolika może mieć najwyżej trzy cyfry"),
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

export type RoomInput = z.output<typeof roomInputSchema>;
export type TableInput = z.output<typeof tableInputSchema>;
export type TablePositionInput = z.output<typeof tablePositionSchema>;
