import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { menuItemInputSchema, type MenuItemInput } from "@/lib/schemas/menu";
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  AVAILABILITY,
  AVAILABILITY_LABELS,
  type Allergen,
  type MenuCategory,
  type MenuItem,
  type MenuItemAvailability,
} from "@/types";

const NO_CATEGORY = "none";

interface MenuItemDialogProps {
  open: boolean;
  item: MenuItem | null;
  categories: MenuCategory[];
  defaultCategoryId: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: MenuItemInput) => Promise<void>;
}

export function MenuItemDialog({
  open,
  item,
  categories,
  defaultCategoryId,
  onOpenChange,
  onSubmit,
}: MenuItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edytuj pozycję" : "Nowa pozycja"}</DialogTitle>
          <DialogDescription>Nazwa, cena i dostępność są widoczne dla klientów.</DialogDescription>
        </DialogHeader>
        {/* Radix unmounts the content on close, so the form state resets on
            every open without an effect. */}
        <MenuItemForm
          item={item}
          categories={categories}
          defaultCategoryId={defaultCategoryId}
          onSubmit={onSubmit}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

interface MenuItemFormProps {
  item: MenuItem | null;
  categories: MenuCategory[];
  defaultCategoryId: string | null;
  onSubmit: (input: MenuItemInput) => Promise<void>;
  onDone: () => void;
}

function MenuItemForm({ item, categories, defaultCategoryId, onSubmit, onDone }: MenuItemFormProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price).replace(".", ",") : "");
  const [categoryId, setCategoryId] = useState(
    item ? (item.category_id ?? NO_CATEGORY) : (defaultCategoryId ?? NO_CATEGORY),
  );
  const [availability, setAvailability] = useState<MenuItemAvailability>(item?.availability ?? "available");
  const [allergens, setAllergens] = useState<Allergen[]>(item?.allergens ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleAllergen = (allergen: Allergen, checked: boolean) => {
    setAllergens((previous) => (checked ? [...previous, allergen] : previous.filter((a) => a !== allergen)));
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = menuItemInputSchema.safeParse({
      name,
      description: description || null,
      price: Number(price.trim().replace(",", ".")),
      category_id: categoryId === NO_CATEGORY ? null : categoryId,
      availability,
      allergens,
    });
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
      setError(submitError instanceof Error ? submitError.message : "Nie udało się zapisać pozycji");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="item-name">Nazwa</Label>
        <Input
          id="item-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="np. Pierogi ruskie"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-description">Opis (opcjonalny)</Label>
        <Textarea
          id="item-description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          placeholder="Krótki opis pozycji"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="item-price">Cena (zł)</Label>
          <Input
            id="item-price"
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
            }}
            placeholder="np. 24,50"
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="item-availability">Dostępność</Label>
          <Select
            value={availability}
            onValueChange={(value) => {
              setAvailability(value as MenuItemAvailability);
            }}
          >
            <SelectTrigger id="item-availability" className="w-full">
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
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="item-category">Kategoria</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="item-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CATEGORY}>Bez kategorii</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Alergeny</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALLERGENS.map((allergen) => (
            <label key={allergen} className="flex items-center gap-2 text-sm" htmlFor={`allergen-${allergen}`}>
              <Checkbox
                id={`allergen-${allergen}`}
                checked={allergens.includes(allergen)}
                onCheckedChange={(checked) => {
                  toggleAllergen(allergen, checked === true);
                }}
              />
              {ALLERGEN_LABELS[allergen]}
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">Pełna informacja o alergenach dostępna u obsługi lokalu.</p>
      </fieldset>

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
