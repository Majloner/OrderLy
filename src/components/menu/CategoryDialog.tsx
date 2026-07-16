import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { menuCategoryInputSchema, type MenuCategoryInput } from "@/lib/schemas/menu";
import type { MenuCategory } from "@/types";

interface CategoryDialogProps {
  open: boolean;
  category: MenuCategory | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: MenuCategoryInput) => Promise<void>;
}

export function CategoryDialog({ open, category, onOpenChange, onSubmit }: CategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Edytuj kategorię" : "Nowa kategoria"}</DialogTitle>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the form state resets on
            every open without an effect. */}
        <CategoryForm
          category={category}
          onSubmit={onSubmit}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CategoryFormProps {
  category: MenuCategory | null;
  onSubmit: (input: MenuCategoryInput) => Promise<void>;
  onDone: () => void;
}

function CategoryForm({ category, onSubmit, onDone }: CategoryFormProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = menuCategoryInputSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(parsed.data);
      onDone();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać kategorii");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="category-name">Nazwa kategorii</Label>
        <Input
          id="category-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="np. Zupy"
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Anuluj
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz"}
        </Button>
      </DialogFooter>
    </form>
  );
}
