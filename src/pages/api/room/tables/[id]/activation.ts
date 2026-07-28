import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonData, jsonError, parseBody } from "@/lib/api";
import { guardTablesRequest } from "@/lib/room-api";
import { tableActivationSchema } from "@/lib/schemas/room";

export const prerender = false;

const idSchema = z.uuid();

// FR-009 activation, as a single-field write. Deliberately NOT a full PUT: rebuilding
// the whole body from client state lets a stale tab silently revert a drag or rename
// made elsewhere, since all seven columns get rewritten (impl-review F5). Mirrors the
// position route's reasoning.
export const PATCH: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator stolika", 400);
  }

  const body = await parseBody(context, tableActivationSchema);
  if ("error" in body) {
    return body.error;
  }

  const { data, error } = await guard.supabase
    .from("tables")
    .update({ is_active: body.input.is_active })
    .eq("id", id.data)
    .select("*");

  if (error) {
    return jsonError("Nie udało się zmienić stanu stolika", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono stolika", 404);
  }

  return jsonData(data[0]);
};
