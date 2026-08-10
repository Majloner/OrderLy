import type { APIRoute } from "astro";
import { jsonData, jsonError, parseBody } from "@/lib/api";
import { clampObjectCenter } from "@/lib/room-geometry";
import { guardTablesRequest, isForeignKeyViolation, roomExistsInCompany } from "@/lib/room-api";
import { roomObjectInputSchema } from "@/lib/schemas/room";
import type { RoomObject } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, roomObjectInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // Defence in depth, not the guarantee: room_objects carries a composite
  // (company_id, room_id) FK, so a foreign room is impossible at the schema level.
  // This check exists to turn that into a clear 400 instead of a bare 23503.
  if (!(await roomExistsInCompany(guard.supabase, body.input.room_id))) {
    return jsonError("Nie znaleziono wskazanej sali", 400);
  }

  // pos_x/pos_y are the object's CENTRE, and the clamp is both footprint- and
  // rotation-aware. Authoritative here: the client cannot push an object's rotated
  // bounding box off the plan.
  const position = clampObjectCenter(
    body.input,
    { width: body.input.width, height: body.input.height },
    body.input.rotation,
  );

  const { data, error } = await guard.supabase
    .from("room_objects")
    .insert({
      company_id: guard.companyId,
      room_id: body.input.room_id,
      kind: body.input.kind,
      label: body.input.label,
      pos_x: position.pos_x,
      pos_y: position.pos_y,
      width: body.input.width,
      height: body.input.height,
      rotation: body.input.rotation,
    })
    .select("*")
    .single<RoomObject>();

  if (error) {
    // The composite FK firing means the room is not this company's.
    if (isForeignKeyViolation(error)) {
      return jsonError("Nie znaleziono wskazanej sali", 400);
    }
    // No 409 branch: objects have no number and no unique index — a room may hold
    // any number of identical chairs.
    return jsonError("Nie udało się utworzyć obiektu", 500);
  }

  return jsonData(data, 201);
};
