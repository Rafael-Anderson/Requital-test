import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

// Bill of Materials — one recipe row. Shared shape for both the product-level
// default list (CreateProductDto/UpdateProductDto's `ingredients`, always
// variantId: null) and a single variant's override list
// (UpdateVariantDto's `ingredients`, always that one variantId) — see
// ProductsService.replaceProductIngredients/replaceVariantIngredients. No
// variantId field here: which list a given array belongs to already fixes
// it, so it's never accepted from the client, only set server-side.
export class ProductIngredientInput {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  ingredientId: number;

  // Whole units only — see productingredient.quantityPerUnit's schema comment.
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantityPerUnit: number;
}
