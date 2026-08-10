import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonData, jsonError, parseBody } from "@/lib/api";
import { clampObjectCenter } from "@/lib/room-geometry";
import { guardTablesRequest } from "@/lib/room-api";
import { roomObjectTransformSchema } from "@/lib/schemas/room";

export const prerender = false;

const idSchema = z.uuid();

// End of a resize or rotate gesture. Sibling of ./position, and separate from PUT for
// the reason this module keeps re-learning: a full PUT rebuilds room_id, kind and label
// from client state, so one landing behind a queued request silently reverts a rename or
// a room move made in the meantime (impl-review F5). This touches geometry only.
//
// Unlike ./position it needs no read first. That route has to fetch width, height and
// rotation because it is changing none of them and the clamp is footprint- and
// rotation-aware; here the request carries all three, so one round trip does it.
export const PATCH: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator obiektu", 400);
  }

  const body = await parseBody(context, roomObjectTransformSchema);
  if ("error" in body) {
    return body.error;
  }

  // Authoritative on the server, exactly as for a drag: the client cannot park a
  // rotated bounding box outside the plan by resizing into the edge.
  const position = clampObjectCenter(
    body.input,
    { width: body.input.width, height: body.input.height },
    body.input.rotation,
  );

  const { data, error } = await guard.supabase
    .from("room_objects")
    .update({
      pos_x: position.pos_x,
      pos_y: position.pos_y,
      width: body.input.width,
      height: body.input.height,
      rotation: body.input.rotation,
    })
    .eq("id", id.data)
    .select("*");

  if (error) {
    return jsonError("Nie udało się zapisać elementu", 500);
  }
  // RLS makes another tenant's row simply absent, so an empty result is a 404.
  if (data.length === 0) {
    return jsonError("Nie znaleziono obiektu", 404);
  }

  return jsonData(data[0]);
};
