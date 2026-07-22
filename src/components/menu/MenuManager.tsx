import { useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { callMenuApi, useMenu } from "@/components/hooks/useMenu";
import { putSignedBlob } from "@/lib/images";
import type { MenuCategoryInput, MenuItemInput } from "@/lib/schemas/menu";
import type { MenuCategory, MenuItem, MenuPayload } from "@/types";
import { CategoryDialog } from "./CategoryDialog";
import { CategorySection } from "./CategorySection";
import { MenuItemDialog, type PhotoIntent } from "./MenuItemDialog";

type ConfirmState = { type: "archive-item"; item: MenuItem } | { type: "delete-category"; category: MenuCategory };

interface SignedUploadResponse {
  full: { signedUrl: string };
  thumb: { signedUrl: string };
}

export default function MenuManager({ supabaseUrl }: { supabaseUrl: string }) {
  const { menu, setMenu, loadError, refetch, reload } = useMenu();
  const [actionError, setActionError] = useState<string | null>(null);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editedCategory, setEditedCategory] = useState<MenuCategory | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editedItem, setEditedItem] = useState<MenuItem | null>(null);
  const [itemDefaultCategoryId, setItemDefaultCategoryId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Full-screen error only when there is nothing to show yet (initial load).
  // A failed refetch after a successful mutation surfaces as actionError below,
  // keeping the already-rendered menu on screen.
  if (!menu) {
    if (loadError) {
      return (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-red-100">
          <p>{loadError}</p>
          <Button type="button" variant="outline" className="mt-4" onClick={reload}>
            Spróbuj ponownie
          </Button>
        </div>
      );
    }
    return <p className="text-white/60">Ładowanie menu…</p>;
  }

  const categoryIds = new Set(menu.categories.map((category) => category.id));
  const itemsFor = (categoryId: string) => menu.items.filter((item) => item.category_id === categoryId);
  // "Bez kategorii" also catches items whose category_id no longer resolves to a
  // known category (e.g. a category deleted between GET /api/menu's two reads),
  // so they never silently vanish from the management view.
  const uncategorized = menu.items.filter((item) => item.category_id === null || !categoryIds.has(item.category_id));

  const openCreateCategory = () => {
    setEditedCategory(null);
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: MenuCategory) => {
    setEditedCategory(category);
    setCategoryDialogOpen(true);
  };

  const openCreateItem = (categoryId: string | null) => {
    setEditedItem(null);
    setItemDefaultCategoryId(categoryId);
    setItemDialogOpen(true);
  };

  const openEditItem = (item: MenuItem) => {
    setEditedItem(item);
    setItemDefaultCategoryId(null);
    setItemDialogOpen(true);
  };

  // Dialog submits: errors propagate to the dialog, which renders them inline.
  const saveCategory = async (input: MenuCategoryInput) => {
    if (editedCategory) {
      await callMenuApi("PUT", `/api/menu/categories/${editedCategory.id}`, input);
    } else {
      await callMenuApi("POST", "/api/menu/categories", input);
    }
    await refetch();
  };

  // Save the row first (POST returns the new id needed for the photo path),
  // then run the photo intent, then a single refetch reflects both.
  const saveItem = async (input: MenuItemInput, photo: PhotoIntent) => {
    const saved = editedItem
      ? await callMenuApi<MenuItem>("PUT", `/api/menu/items/${editedItem.id}`, input)
      : await callMenuApi<MenuItem>("POST", "/api/menu/items", input);
    if (photo.kind === "upload") {
      await uploadItemPhoto(saved.id, photo.full, photo.thumb);
    } else if (photo.kind === "remove") {
      await callMenuApi("DELETE", `/api/menu/items/${saved.id}/photo`);
    }
    await refetch();
  };

  // Server mints signed upload URLs (service role) after authorizing the request;
  // the browser PUTs both blobs straight to Storage, then links the row.
  const uploadItemPhoto = async (itemId: string, full: Blob, thumb: Blob) => {
    const urls = await callMenuApi<SignedUploadResponse>("POST", `/api/menu/items/${itemId}/photo-url`, {
      contentType: "image/webp",
      fullSize: full.size,
      thumbSize: thumb.size,
    });
    await Promise.all([putSignedBlob(urls.full.signedUrl, full), putSignedBlob(urls.thumb.signedUrl, thumb)]);
    await callMenuApi("PUT", `/api/menu/items/${itemId}/photo`);
  };

  const handleConfirm = async () => {
    if (!confirm) {
      return;
    }
    setActionError(null);
    try {
      if (confirm.type === "archive-item") {
        await callMenuApi("DELETE", `/api/menu/items/${confirm.item.id}`);
      } else {
        await callMenuApi("DELETE", `/api/menu/categories/${confirm.category.id}`);
      }
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Operacja nie powiodła się");
    } finally {
      setConfirm(null);
    }
  };

  // Optimistic reorder with rollback — the only optimistic mutation (plan).
  const persistReorder = async (url: string, ids: string[], optimistic: MenuPayload) => {
    const previous = menu;
    setMenu(optimistic);
    setActionError(null);
    try {
      await callMenuApi("PUT", url, ids);
    } catch (error) {
      setMenu(previous);
      setActionError(error instanceof Error ? error.message : "Nie udało się zapisać kolejności");
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    if (active.data.current?.type === "category") {
      const oldIndex = menu.categories.findIndex((c) => c.id === active.id);
      const newIndex = menu.categories.findIndex((c) => c.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      const categories = arrayMove(menu.categories, oldIndex, newIndex);
      void persistReorder(
        "/api/menu/categories/reorder",
        categories.map((c) => c.id),
        { ...menu, categories },
      );
      return;
    }

    if (active.data.current?.type === "item") {
      const sectionId = active.data.current.sectionId as string;
      const overSectionId = over.data.current?.sectionId as string | undefined;
      // Sorting stays within one section; cross-category moves go through the
      // edit dialog (PUT items/[id] with a new category_id).
      if (sectionId !== overSectionId) {
        return;
      }
      const inSection = (item: MenuItem) => (item.category_id ?? "none") === sectionId;
      const sectionItems = menu.items.filter(inSection);
      const oldIndex = sectionItems.findIndex((item) => item.id === active.id);
      const newIndex = sectionItems.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      const reordered = arrayMove(sectionItems, oldIndex, newIndex);
      let cursor = 0;
      const items = menu.items.map((item) => (inSection(item) ? (reordered[cursor++] ?? item) : item));
      void persistReorder(
        "/api/menu/items/reorder",
        reordered.map((item) => item.id),
        { ...menu, items },
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={openCreateCategory}>
          <Plus className="size-4" /> Dodaj kategorię
        </Button>
        <Button
          type="button"
          onClick={() => {
            openCreateItem(null);
          }}
        >
          <Plus className="size-4" /> Dodaj pozycję
        </Button>
      </div>

      {actionError && (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {actionError}
        </p>
      )}

      {menu.items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-center">
          <p className="text-white/70">Twoje menu jest jeszcze puste.</p>
          <Button
            type="button"
            className="mt-4"
            onClick={() => {
              openCreateItem(null);
            }}
          >
            <Plus className="size-4" /> Dodaj pierwszą pozycję
          </Button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="space-y-4">
          <SortableContext items={menu.categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {menu.categories.map((category) => (
              <CategorySection
                key={category.id}
                category={category}
                items={itemsFor(category.id)}
                supabaseUrl={supabaseUrl}
                onEditCategory={openEditCategory}
                onDeleteCategory={(target) => {
                  setConfirm({ type: "delete-category", category: target });
                }}
                onAddItem={openCreateItem}
                onEditItem={openEditItem}
                onArchiveItem={(target) => {
                  setConfirm({ type: "archive-item", item: target });
                }}
              />
            ))}
          </SortableContext>
          {uncategorized.length > 0 && (
            <CategorySection
              category={null}
              items={uncategorized}
              supabaseUrl={supabaseUrl}
              onEditCategory={() => undefined}
              onDeleteCategory={() => undefined}
              onAddItem={openCreateItem}
              onEditItem={openEditItem}
              onArchiveItem={(target) => {
                setConfirm({ type: "archive-item", item: target });
              }}
            />
          )}
        </div>
      </DndContext>

      <CategoryDialog
        open={categoryDialogOpen}
        category={editedCategory}
        onOpenChange={setCategoryDialogOpen}
        onSubmit={saveCategory}
      />

      <MenuItemDialog
        open={itemDialogOpen}
        item={editedItem}
        categories={menu.categories}
        defaultCategoryId={itemDefaultCategoryId}
        supabaseUrl={supabaseUrl}
        onOpenChange={setItemDialogOpen}
        onSubmit={saveItem}
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === "delete-category"
                ? `Usunąć kategorię „${confirm.category.name}”?`
                : `Zarchiwizować pozycję „${confirm?.item.name ?? ""}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "delete-category"
                ? "Pozycje z tej kategorii trafią do sekcji „Bez kategorii”."
                : "Pozycja zniknie z menu. Nazwa będzie mogła zostać użyta ponownie."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirm()}>
              {confirm?.type === "delete-category" ? "Usuń" : "Zarchiwizuj"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
