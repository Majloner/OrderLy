import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { publicPhotoUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { ALLERGEN_LABELS, AVAILABILITY_LABELS, type MenuItem } from "@/types";

const priceFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});

const availabilityBadgeClass: Record<MenuItem["availability"], string> = {
  available: "border-green-400/40 bg-green-500/15 text-green-200",
  // Neutral entry moved to the semantic tokens in phase 3 (the white-alpha
  // sweep); the two coloured entries follow in phase 4 with the full map.
  unavailable: "border-neutral-border bg-neutral-fill text-neutral-fg",
  sold_out: "border-amber-400/40 bg-amber-500/15 text-amber-200",
};

interface MenuItemRowProps {
  item: MenuItem;
  sectionId: string;
  supabaseUrl: string;
  onEdit: (item: MenuItem) => void;
  onArchive: (item: MenuItem) => void;
}

export function MenuItemRow({ item, sectionId, supabaseUrl, onEdit, onArchive }: MenuItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", sectionId },
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
      <button
        type="button"
        className="mt-1 cursor-grab touch-none text-white/40 hover:text-white/80"
        aria-label={`Przeciągnij pozycję ${item.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {thumbUrl ? (
        <img src={thumbUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="border-border bg-card flex size-12 shrink-0 items-center justify-center rounded-md border text-white/30">
          <ImageIcon className="size-5" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-white">{item.name}</span>
          <span className="text-sm text-blue-100/80">{priceFormatter.format(item.price)}</span>
          <Badge variant="outline" className={availabilityBadgeClass[item.availability]}>
            {AVAILABILITY_LABELS[item.availability]}
          </Badge>
        </div>
        {item.description && <p className="mt-1 truncate text-sm text-white/50">{item.description}</p>}
        {item.allergens.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.allergens.map((allergen) => (
              <Badge
                key={allergen}
                variant="outline"
                className="border-neutral-border bg-neutral-fill text-xs text-white/60"
              >
                {ALLERGEN_LABELS[allergen]}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-white/60 hover:text-white"
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
          className="text-white/60 hover:text-red-300"
          aria-label={`Zarchiwizuj pozycję ${item.name}`}
          onClick={() => {
            onArchive(item);
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}
