import type { APIRoute } from "astro";
import { isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { clampPosition } from "@/lib/room-geometry";
import { guardTablesRequest, roomExistsInCompany } from "@/lib/room-api";
import { tableInputSchema } from "@/lib/schemas/room";
import type { RoomTable } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, tableInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // A cross-tenant room_id would slip past RLS via FK validation, so verify
  // ownership before the insert.
  if (!(await roomExistsInCompany(guard.supabase, body.input.room_id))) {
    return jsonError("Nie znaleziono wskazanej sali", 400);
  }

  const position = clampPosition(body.input, body.input.shape);

  const { data, error } = await guard.supabase
    .from("tables")
    .insert({
      company_id: guard.companyId,
      room_id: body.input.room_id,
      number: body.input.number,
      label: body.input.label,
      shape: body.input.shape,
      pos_x: position.pos_x,
      pos_y: position.pos_y,
      is_active: body.input.is_active,
    })
    .select("*")
    .single<RoomTable>();

  if (error) {
    // FR-010: the number is the table's primary identifier within the company.
    if (isUniqueViolation(error)) {
      return jsonError("Stolik o tym numerze już istnieje", 409);
    }
    return jsonError("Nie udało się utworzyć stolika", 500);
  }

  return jsonData(data, 201);
};
