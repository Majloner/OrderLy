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

  // Objects ship in the same payload rather than behind their own endpoint: the
  // canvas needs tables and furnishing together to draw one plan, so one fetch
  // keeps a single state and one optimistic-rollback path.
  const [rooms, tables, objects] = await Promise.all([
    guard.supabase.from("rooms").select("*").order("sort_order").order("name"),
    guard.supabase.from("tables").select("*").order("number"),
    guard.supabase.from("room_objects").select("*").order("created_at"),
  ]);

  if (rooms.error || tables.error || objects.error) {
    return jsonError("Nie udało się pobrać schematu sali", 500);
  }

  return jsonData({ rooms: rooms.data, tables: tables.data, objects: objects.data });
};
