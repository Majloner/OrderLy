import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonData, jsonError, parseBody } from "@/lib/api";
import { clampObjectCenter } from "@/lib/room-geometry";
import { guardTablesRequest, isForeignKeyViolation, roomExistsInCompany } from "@/lib/room-api";
import { roomObjectInputSchema } from "@/lib/schemas/room";

export const prerender = false;

const idSchema = z.uuid();

export const PUT: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator obiektu", 400);
  }

  const body = await parseBody(context, roomObjectInputSchema);
  if ("error" in body) {
    return body.error;
  }

  if (!(await roomExistsInCompany(guard.supabase, body.input.room_id))) {
    return jsonError("Nie znaleziono wskazanej sali", 400);
  }

  const position = clampObjectCenter(
    body.input,
    { width: body.input.width, height: body.input.height },
    body.input.rotation,
  );

  const { data, error } = await guard.supabase
    .from("room_objects")
    .update({
      room_id: body.input.room_id,
      kind: body.input.kind,
      label: body.input.label,
      pos_x: position.pos_x,
      pos_y: position.pos_y,
      width: body.input.width,
      height: body.input.height,
      rotation: body.input.rotation,
    })
    .eq("id", id.data)
    .select("*");

  if (error) {
    if (isForeignKeyViolation(error)) {
      return jsonError("Nie znaleziono wskazanej sali", 400);
    }
    return jsonError("Nie udało się zapisać obiektu", 500);
  }
  // RLS makes another tenant's row simply absent, so an empty result is a 404.
  if (data.length === 0) {
    return jsonError("Nie znaleziono obiektu", 404);
  }

  return jsonData(data[0]);
};

// The handler that has NO counterpart under api/room/tables/. Deleting an object is
// allowed precisely because no permanent QR code points at a chair, so the
// "deactivate, never delete" guardrail that governs tables (enforced by the absence
// of a delete policy in RLS) does not apply. room_objects has
// room_objects_delete_owner for exactly this route. If you are here looking for the
// table equivalent: it does not exist, and that is deliberate — see the header of
// src/pages/api/room/tables/[id].ts.
export const DELETE: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator obiektu", 400);
  }

  const { data, error } = await guard.supabase.from("room_objects").delete().eq("id", id.data).select("id");

  if (error) {
    return jsonError("Nie udało się usunąć obiektu", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono obiektu", 404);
  }

  return jsonData({ id: id.data });
};
