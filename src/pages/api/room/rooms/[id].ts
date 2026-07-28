import type { APIRoute } from "astro";
import { z } from "zod";
import { isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { guardTablesRequest, isForeignKeyViolation } from "@/lib/room-api";
import { roomInputSchema } from "@/lib/schemas/room";

export const prerender = false;

const idSchema = z.uuid();

export const PUT: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator sali", 400);
  }

  const body = await parseBody(context, roomInputSchema);
  if ("error" in body) {
    return body.error;
  }

  const { data, error } = await guard.supabase
    .from("rooms")
    .update({ name: body.input.name })
    .eq("id", id.data)
    .select("*");

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("Sala o tej nazwie już istnieje", 409);
    }
    return jsonError("Nie udało się zapisać sali", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono sali", 404);
  }

  return jsonData(data[0]);
};

// Only an EMPTY room can be deleted. tables.room_id is ON DELETE RESTRICT, so
// the DB raises 23503 rather than cascading tables (and their permanent QR
// codes from S-07) away — we surface that as a 409 the UI can explain.
export const DELETE: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator sali", 400);
  }

  const { data, error } = await guard.supabase.from("rooms").delete().eq("id", id.data).select("id");

  if (error) {
    if (isForeignKeyViolation(error)) {
      return jsonError("Sala ma przypisane stoliki — najpierw przenieś je do innej sali", 409);
    }
    return jsonError("Nie udało się usunąć sali", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono sali", 404);
  }

  return jsonData({ id: id.data });
};
