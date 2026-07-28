import type { APIRoute } from "astro";
import { z } from "zod";
import { isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { clampPosition } from "@/lib/room-geometry";
import { guardTablesRequest, roomExistsInCompany } from "@/lib/room-api";
import { tableInputSchema } from "@/lib/schemas/room";

export const prerender = false;

const idSchema = z.uuid();

// Full update: identity (number, label, shape), placement (room_id, position)
// and activation (is_active, FR-009) all arrive from the table dialog.
//
// There is deliberately NO DELETE handler in this tree: a table is never hard
// deleted, so the permanent QR code from S-07 can never point at a vanished row.
// RLS carries no delete policy for public.tables either — both layers agree.
export const PUT: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator stolika", 400);
  }

  const body = await parseBody(context, tableInputSchema);
  if ("error" in body) {
    return body.error;
  }

  if (!(await roomExistsInCompany(guard.supabase, body.input.room_id))) {
    return jsonError("Nie znaleziono wskazanej sali", 400);
  }

  const position = clampPosition(body.input, body.input.shape);

  const { data, error } = await guard.supabase
    .from("tables")
    .update({
      room_id: body.input.room_id,
      number: body.input.number,
      label: body.input.label,
      shape: body.input.shape,
      pos_x: position.pos_x,
      pos_y: position.pos_y,
      is_active: body.input.is_active,
    })
    .eq("id", id.data)
    .select("*");

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("Stolik o tym numerze już istnieje", 409);
    }
    return jsonError("Nie udało się zapisać stolika", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono stolika", 404);
  }

  return jsonData(data[0]);
};
