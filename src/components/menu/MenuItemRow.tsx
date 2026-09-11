import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { publicPhotoUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { ALLERGEN_LABELS, AVAILABILITY, AVAILABILITY_LABELS, type MenuItem, type MenuItemAvailability } from "@/types";

const priceFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});

// Meaning-bearing map on the semantic triples from global.css — fifteen
// contrast decisions made once, centrally (test-plan/plan.md phase 4).
const availabilityBadgeClass: Record<MenuItem["availability"], string> = {
  available: "border-success-border bg-success-fill text-success-fg",
  unavailable: "border-neutral-border bg-neutral-fill text-neutral-fg",
  sold_out: "border-warning-border bg-warning-fill text-warning-fg",
};

interface MenuItemRowProps {
  item: MenuItem;
  sectionId: string;
  supabaseUrl: string;
  // S-05 display gating (guard + RLS enforce): CRUD is the owner's, the
  // availability toggle is the owner's and the waiter's; kitchen sees a badge.
  canEditMenu: boolean;
  canToggleAvailability: boolean;
  availabilityBusy: boolean;
  onChangeAvailability: (item: MenuItem, availability: MenuItemAvailability) => Promise<void>;
  onEdit: (item: MenuItem) => void;
  onArchive: (item: MenuItem) => void;
}

export function MenuItemRow({
  item,
  sectionId,
  supabaseUrl,
  canEditMenu,
  canToggleAvailability,
  availabilityBusy,
  onChangeAvailability,
  onEdit,
  onArchive,
}: MenuItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", sectionId },
    disabled: !canEditMenu,
  });

  const thumbUrl = item.photo_path
    ? publicPhotoUrl(supabaseUrl, item.photo_path, "thumb", item.photo_updated_at)
    : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "border-border bg-card flex items-start gap-2 rounded-lg border p-3",
        isDragging && "z-10 opacity-70",
      )}
    >
      {canEditMenu && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-1 cursor-grab touch-none"
          aria-label={`Przeciągnij pozycję ${item.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}

      {thumbUrl ? (
        <img src={thumbUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="border-border bg-card text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md border">
          <ImageIcon className="size-5" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* The signature printed-menu line: name, dotted leader, tabular price.
            The leader is a flex-filling dotted border, so it shrinks to its
            min-width when a long name wraps, and aria-hidden keeps screen
            readers announcing "name, price" without the dots. */}
        <div className="flex items-baseline gap-1">
          <span className="text-foreground min-w-0 font-medium break-words">{item.name}</span>
          <span
            aria-hidden="true"
            className="border-neutral-border mx-1 mb-1 min-w-6 flex-1 self-end border-b-2 border-dotted"
          />
          <span className="text-foreground shrink-0 text-sm font-medium tabular-nums">
            {priceFormatter.format(item.price)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {canToggleAvailability ? (
            // S-05 quick toggle: three states, so a Select rather than a binary
            // switch. Styled with the same semantic triple as the badge, so the
            // state stays readable at a glance while it becomes actionable.
            <Select
              value={item.availability}
              disabled={availabilityBusy}
              onValueChange={(value) => {
                void onChangeAvailability(item, value as MenuItemAvailability);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Zmień dostępność pozycji ${item.name}`}
                className={cn("h-7 gap-1 px-2 text-xs font-medium", availabilityBadgeClass[item.availability])}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABILITY.map((value) => (
                  <SelectItem key={value} value={value}>
                    {AVAILABILITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline" className={availabilityBadgeClass[item.availability]}>
              {AVAILABILITY_LABELS[item.availability]}
            </Badge>
          )}
        </div>
        {item.description && <p className="text-muted-foreground mt-1 truncate text-sm">{item.description}</p>}
        {item.allergens.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.allergens.map((allergen) => (
              <Badge
                key={allergen}
                variant="outline"
                className="border-neutral-border bg-neutral-fill text-muted-foreground text-xs"
              >
                {ALLERGEN_LABELS[allergen]}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {canEditMenu && (
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Edytuj pozycję ${item.name}`}
            onClick={() => {
              onEdit(item);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Zarchiwizuj pozycję ${item.name}`}
            onClick={() => {
              onArchive(item);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}
