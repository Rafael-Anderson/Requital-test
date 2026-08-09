import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IngredientRecipeEditor, { type RecipeRowDraft } from "./IngredientRecipeEditor";
import type { Ingredient, IngredientCategory } from "@/lib/types";

afterEach(cleanup);

function fakeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 1,
    name: "Rose",
    unit: "stems",
    trackInventory: true,
    image: null,
    description: null,
    costPerUnit: null,
    supplier: null,
    categoryId: null,
    categoryName: null,
    createdAt: new Date().toISOString(),
    stockQuantity: null,
    lowStockThreshold: null,
    ...overrides,
  };
}

const ingredients: Ingredient[] = [fakeIngredient({ id: 1, name: "Rose" }), fakeIngredient({ id: 2, name: "Box" })];
const categories: IngredientCategory[] = [{ id: 1, name: "Flowers" }];
const rows: RecipeRowDraft[] = [{ ingredientId: 1, quantityPerUnit: "6" }];

describe("IngredientRecipeEditor — category filter and row pickers", () => {
  it("renders both pickers as Comboboxes, not native selects", () => {
    render(<IngredientRecipeEditor ingredients={ingredients} categories={categories} rows={rows} onChange={vi.fn()} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(2); // category filter + 1 row
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("changing the row's ingredient picker calls onChange with the new ingredientId", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IngredientRecipeEditor ingredients={ingredients} categories={categories} rows={rows} onChange={onChange} />);

    const [, rowCombobox] = screen.getAllByRole("combobox");
    await user.click(rowCombobox);
    await user.click(await screen.findByRole("option", { name: "Box" }));

    expect(onChange).toHaveBeenCalledWith([{ ingredientId: 2, quantityPerUnit: "6" }]);
  });
});
