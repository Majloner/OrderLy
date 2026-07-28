import type { APIRoute } from "astro";
import { jsonData, jsonError } from "@/lib/api";
import { guardTablesRequest } from "@/lib/room-api";

export const prerender = false;

// Whole-staff read: one payload for the /room island. Inactive tables are
// included — the owner must see and be able to reactivate them.
export const GET: APIRoute = async (context) => {
  const guard = guardTablesRequest(context, { write: false });
  if ("error" in guard) {
    return guard.error;
  }

  const [rooms, tables] = await Promise.all([
    guard.supabase.from("rooms").select("*").order("sort_order").order("name"),
    guard.supabase.from("tables").select("*").order("number"),
  ]);

  if (rooms.error || tables.error) {
    return jsonError("Nie udało się pobrać schematu sali", 500);
  }

  return jsonData({ rooms: rooms.data, tables: tables.data });
};
