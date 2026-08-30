import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MenuCategory, MenuItem } from "@/types";
import { MenuItemRow } from "./MenuItemRow";

interface CategorySectionProps {
  category: MenuCategory | null; // null renders the trailing "Bez kategorii" section
  items: MenuItem[];
  supabaseUrl: string;
  onEditCategory: (category: MenuCategory) => void;
  onDeleteCategory: (category: MenuCategory) => void;
  onAddItem: (categoryId: string | null) => void;
  onEditItem: (item: MenuItem) => void;
  onArchiveItem: (item: MenuItem) => void;
}

export function CategorySection({
  category,
  items,
  supabaseUrl,
  onEditCategory,
  onDeleteCategory,
  onAddItem,
  onEditItem,
  onArchiveItem,
}: CategorySectionProps) {
  const sectionId = category?.id ?? "none";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category?.id ?? "__uncategorized__",
    data: { type: "category" },
    disabled: !category,
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("border-border bg-card rounded-2xl border p-4 shadow-sm", isDragging && "z-10 opacity-70")}
    >
      <header className="mb-3 flex items-center gap-2">
        {category && (
          <button
            type="button"
            className="cursor-grab touch-none text-white/40 hover:text-white/80"
            aria-label={`Przeciągnij kategorię ${category.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-white">
          {category ? category.name : "Bez kategorii"}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-white/70 hover:text-white"
          onClick={() => {
            onAddItem(category?.id ?? null);
          }}
        >
          <Plus className="size-4" /> Dodaj pozycję
        </Button>
        {category && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-white/60 hover:text-white"
              aria-label={`Edytuj kategorię ${category.name}`}
              onClick={() => {
                onEditCategory(category);
              }}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-white/60 hover:text-red-300"
              aria-label={`Usuń kategorię ${category.name}`}
              onClick={() => {
                onDeleteCategory(category);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-white/40">Brak pozycji w tej kategorii.</p>
      ) : (
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {items.map((item) => (
              <MenuItemRow
                key={item.id}
                item={item}
                sectionId={sectionId}
                supabaseUrl={supabaseUrl}
                onEdit={onEditItem}
                onArchive={onArchiveItem}
              />
            ))}
          </ul>
        </SortableContext>
      )}
    </section>
  );
}
