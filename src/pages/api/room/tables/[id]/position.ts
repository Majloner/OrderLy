import type { APIRoute } from "astro";
import { z } from "zod";
import { jsonData, jsonError, parseBody } from "@/lib/api";
import { clampPosition } from "@/lib/room-geometry";
import { guardTablesRequest } from "@/lib/room-api";
import { tablePositionSchema } from "@/lib/schemas/room";
import type { TableShape } from "@/types";

export const prerender = false;

const idSchema = z.uuid();

// Hot path for canvas drags: one drop, one minimal request. Kept separate from
// PUT so a position change never has to re-send (or re-validate) the whole table.
export const PATCH: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator stolika", 400);
  }

  const body = await parseBody(context, tablePositionSchema);
  if ("error" in body) {
    return body.error;
  }

  // Clamping is footprint-aware, so the shape has to be known first. This SELECT
  // is RLS-scoped: another tenant's table reads as absent and becomes a 404.
  const existing = await guard.supabase
    .from("tables")
    .select("shape")
    .eq("id", id.data)
    .maybeSingle<{ shape: TableShape }>();

  if (existing.error) {
    return jsonError("Nie udało się zapisać pozycji stolika", 500);
  }
  if (!existing.data) {
    return jsonError("Nie znaleziono stolika", 404);
  }

  const position = clampPosition(body.input, existing.data.shape);

  const { data, error } = await guard.supabase
    .from("tables")
    .update({ pos_x: position.pos_x, pos_y: position.pos_y })
    .eq("id", id.data)
    .select("*");

  if (error) {
    return jsonError("Nie udało się zapisać pozycji stolika", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono stolika", 404);
  }

  return jsonData(data[0]);
};
