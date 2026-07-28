import type { APIRoute } from "astro";
import { isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { guardTablesRequest } from "@/lib/room-api";
import { roomInputSchema } from "@/lib/schemas/room";
import type { Room } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, roomInputSchema);
  if ("error" in body) {
    return body.error;
  }

  const { data, error } = await guard.supabase
    .from("rooms")
    .insert({ company_id: guard.companyId, name: body.input.name })
    .select("*")
    .single<Room>();

  if (error) {
    // rooms_company_name_idx is case-insensitive, like menu categories.
    if (isUniqueViolation(error)) {
      return jsonError("Sala o tej nazwie już istnieje", 409);
    }
    return jsonError("Nie udało się utworzyć sali", 500);
  }

  return jsonData(data, 201);
};
