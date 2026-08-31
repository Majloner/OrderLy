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

// Muted next to the bottle-green tables on purpose: furnishing is the backdrop
// a table is read against, so it must not compete with it. Drawn from the
// semantic triples in global.css (every fg-on-fill pair there is recorded at
// AA or better); identity comes from the icon, the tint only groups kinds.
export const ROOM_OBJECT_STYLES: Record<RoomObjectKind, string> = {
  wall: "border-neutral-border bg-neutral-fill text-neutral-fg",
  chair: "border-info-border bg-info-fill text-info-fg",
  door: "border-warning-border bg-warning-fill text-warning-fg",
  window: "border-info-border bg-info-fill/60 text-info-fg",
  bar: "border-warning-border bg-warning-fill/60 text-warning-fg",
  plant: "border-success-border bg-success-fill text-success-fg",
  stairs: "border-neutral-border bg-neutral-fill/60 text-neutral-fg",
  toilet: "border-info-border bg-info-fill text-info-fg",
  till: "border-success-border bg-success-fill/60 text-success-fg",
};
