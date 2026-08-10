import {
  Armchair,
  Blinds,
  BrickWall,
  Calculator,
  ChevronsUp,
  DoorOpen,
  Martini,
  Sprout,
  Toilet,
  type LucideIcon,
} from "lucide-react";
import type { RoomObjectKind } from "@/types";

// One icon per kind. Nine kinds are too many to tell apart by colour alone in a
// dark theme, and text does not fit: a wall renders 20px thin and a chair 40x40,
// so at half scale a label is unreadable. The Polish name lives in the aria-label
// and in the list instead.
//
// `Stairs` does not exist in lucide-react 1.14 (checked against the shipped
// declarations), hence ChevronsUp for a change of level.
export const ROOM_OBJECT_ICONS: Record<RoomObjectKind, LucideIcon> = {
  wall: BrickWall,
  chair: Armchair,
  door: DoorOpen,
  window: Blinds,
  bar: Martini,
  plant: Sprout,
  stairs: ChevronsUp,
  toilet: Toilet,
  till: Calculator,
};

// Muted next to the purple tables on purpose: furnishing is the backdrop a table
// is read against, so it must not compete with it.
export const ROOM_OBJECT_STYLES: Record<RoomObjectKind, string> = {
  wall: "border-white/25 bg-white/20 text-white/70",
  chair: "border-sky-300/30 bg-sky-500/15 text-sky-100/70",
  door: "border-amber-300/30 bg-amber-500/15 text-amber-100/70",
  window: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100/70",
  bar: "border-orange-300/30 bg-orange-500/15 text-orange-100/70",
  plant: "border-emerald-300/30 bg-emerald-500/15 text-emerald-100/70",
  stairs: "border-slate-300/30 bg-slate-400/15 text-slate-100/70",
  toilet: "border-indigo-300/30 bg-indigo-500/15 text-indigo-100/70",
  till: "border-rose-300/30 bg-rose-500/15 text-rose-100/70",
};
