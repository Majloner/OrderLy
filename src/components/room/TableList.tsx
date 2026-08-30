import { Eye, EyeOff, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TABLE_SHAPE_LABELS, type RoomTable } from "@/types";

interface TableListProps {
  tables: RoomTable[];
  busyTableId: string | null;
  onEdit: (table: RoomTable) => void;
  onToggleActive: (table: RoomTable) => void;
}

// Keyboard-reachable path to every table action. The canvas (phase 4) is
// pointer-driven, so this list is the accessible route, not decoration — and it
// deliberately offers no delete: a table is only ever deactivated.
export function TableList({ tables, busyTableId, onEdit, onToggleActive }: TableListProps) {
  return (
    <ul className="space-y-2">
      {tables.map((table) => (
        <li
          key={table.id}
          className={cn(
            "border-border bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2",
            !table.is_active && "opacity-60",
          )}
        >
          <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
            {table.number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{table.label ?? "—"}</span>
            <span className="block text-xs text-white/50">{TABLE_SHAPE_LABELS[table.shape]}</span>
          </span>
          <Badge variant={table.is_active ? "default" : "outline"}>{table.is_active ? "Aktywny" : "Wyłączony"}</Badge>
          <span className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Edytuj stolik ${String(table.number)}`}
              onClick={() => {
                onEdit(table);
              }}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busyTableId === table.id}
              aria-label={
                table.is_active ? `Wyłącz stolik ${String(table.number)}` : `Włącz stolik ${String(table.number)}`
              }
              onClick={() => {
                onToggleActive(table);
              }}
            >
              {table.is_active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
