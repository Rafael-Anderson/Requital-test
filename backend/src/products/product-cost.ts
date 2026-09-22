// What one unit of a product cost the merchant, resolved AT ORDER TIME.
//
// Kept pure (the caller does the querying) so the two branches below are
// testable without a database, and so the cost rule lives in one readable
// place rather than being spread through resolveOrderItems.
//
// Two cases, and only two - there is no bundle/kit concept in this codebase
// (checked, 2026-09-21):
//
//   usesIngredients = false  ->  the product's own costPrice.
//   usesIngredients = true   ->  the sum of its recipe, quantityPerUnit x
//                                the ingredient's costPerUnit.
//
// Why a plain product does NOT read its shadow ingredient's costPerUnit,
// even though every product has one since Phase A: a shadow is seeded with
// product.costPrice at provisioning and, until 2026-09-21, was never resynced
// when the merchant edited that cost, so it could be arbitrarily stale. That
// sync is fixed now, but reading the product's own column is still the right
// answer - it is the value the merchant actually edits, and it removes a hop
// that can only ever drift.
//
// Null, never zero, when the cost cannot be determined: a product with no
// costPrice set, or a recipe with an ingredient whose costPerUnit is unset. A
// zero cost silently reports as 100% margin, which is a far worse lie than
// "unknown" - and most merchants have never filled these fields in.

export interface RecipeLine {
  ingredientId: number;
  quantityPerUnit: number;
  // null when the merchant has not costed this ingredient.
  costPerUnit: string | null;
}

export interface UnitCostInput {
  usesIngredients: boolean;
  // The product's own cost. Variants have no costPrice column of their own,
  // so a variant inherits this.
  costPrice: string | null;
  // Empty for a plain product. For a recipe product, the lines that apply to
  // the specific variant being ordered (the caller filters).
  recipe: RecipeLine[];
}

export function resolveUnitCost(input: UnitCostInput): string | null {
  if (!input.usesIngredients) {
    return normalizeMoney(input.costPrice);
  }

  // A product flagged as recipe-backed with no recipe rows has no knowable
  // cost. Returning 0 here would report the whole line as pure margin.
  if (input.recipe.length === 0) return null;

  let total = 0;
  for (const line of input.recipe) {
    if (line.costPerUnit === null) return null;
    const cost = Number(line.costPerUnit);
    const quantity = Number(line.quantityPerUnit);
    if (!Number.isFinite(cost) || !Number.isFinite(quantity)) return null;
    total += cost * quantity;
  }
  // Two decimal places: these are money, and the DECIMAL(65,30) column would
  // otherwise persist the full binary-float tail of a multiplication.
  return total.toFixed(2);
}

function normalizeMoney(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(2);
}
