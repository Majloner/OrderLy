import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonData, jsonError, parseBody } from "@/lib/api";
import { clampObjectCenter } from "@/lib/room-geometry";
import { guardTablesRequest } from "@/lib/room-api";
import { roomObjectPositionSchema } from "@/lib/schemas/room";

export const prerender = false;

const idSchema = z.uuid();

// Hot path for canvas drags: one drop, one minimal request. Kept separate from PUT
// so a drag can never blind-overwrite the size or rotation from stale client state
// — the failure mode impl-review F5 found in the table activation toggle.
export const PATCH: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator obiektu", 400);
  }

  const body = await parseBody(context, roomObjectPositionSchema);
  if ("error" in body) {
    return body.error;
  }

  // Clamping needs three columns, not one: the bounding box depends on the size AND
  // the angle. Same two-round-trip shape as the table position route, which only
  // has to fetch `shape`. The SELECT is RLS-scoped, so another tenant's object
  // reads as absent and becomes a 404.
  const existing = await guard.supabase
    .from("room_objects")
    .select("width, height, rotation")
    .eq("id", id.data)
    .maybeSingle<{ width: number; height: number; rotation: number }>();

  if (existing.error) {
    return jsonError("Nie udało się zapisać pozycji obiektu", 500);
  }
  if (!existing.data) {
    return jsonError("Nie znaleziono obiektu", 404);
  }

  const position = clampObjectCenter(
    body.input,
    { width: existing.data.width, height: existing.data.height },
    existing.data.rotation,
  );

  const { data, error } = await guard.supabase
    .from("room_objects")
    .update({ pos_x: position.pos_x, pos_y: position.pos_y })
    .eq("id", id.data)
    .select("*");

  if (error) {
    return jsonError("Nie udało się zapisać pozycji obiektu", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono obiektu", 404);
  }

  return jsonData(data[0]);
};
