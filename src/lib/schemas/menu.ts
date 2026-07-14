import { z } from "zod";
import { ALLERGENS, AVAILABILITY } from "@/types";

// numeric(10,2) in the DB: positive, at most two decimal places.
function hasAtMostTwoDecimals(value: number): boolean {
  return /^\d+(\.\d{1,2})?$/.test(String(value));
}

export const menuCategoryInputSchema = z.object({
  name: z
    .string("Nazwa kategorii jest wymagana")
    .trim()
    .min(1, "Nazwa kategorii jest wymagana")
    .max(80, "Nazwa kategorii może mieć najwyżej 80 znaków"),
});

export const menuItemInputSchema = z.object({
  name: z
    .string("Nazwa pozycji jest wymagana")
    .trim()
    .min(1, "Nazwa pozycji jest wymagana")
    .max(120, "Nazwa pozycji może mieć najwyżej 120 znaków"),
  description: z
    .string("Opis musi być tekstem")
    .trim()
    .max(500, "Opis może mieć najwyżej 500 znaków")
    .nullish()
    .transform((value) => {
      if (!value) {
        return null;
      }
      return value;
    }),
  price: z
    .number("Cena musi być liczbą")
    .positive("Cena musi być większa od zera")
    .max(99_999_999.99, "Cena jest zbyt wysoka")
    .refine(hasAtMostTwoDecimals, "Cena może mieć najwyżej dwa miejsca po przecinku"),
  category_id: z
    .uuid("Nieprawidłowy identyfikator kategorii")
    .nullish()
    .transform((value) => value ?? null),
  availability: z.enum(AVAILABILITY, "Nieprawidłowa wartość dostępności"),
  allergens: z
    .array(z.enum(ALLERGENS, "Nieznany alergen"), "Alergeny muszą być listą")
    .refine((allergens) => new Set(allergens).size === allergens.length, "Alergeny nie mogą się powtarzać"),
});

export const reorderSchema = z
  .array(z.uuid("Nieprawidłowy identyfikator"), "Wymagana lista identyfikatorów")
  .min(1, "Lista identyfikatorów nie może być pusta");

export type MenuCategoryInput = z.output<typeof menuCategoryInputSchema>;
export type MenuItemInput = z.output<typeof menuItemInputSchema>;
