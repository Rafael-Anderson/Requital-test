import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductIngredientInput } from './product-ingredient-input.dto';

// The row-level "fuller field set" edit for a single generated variant — sku/
// price/etc left null here fall back to the parent product's own field (see
// ProductsService.toResponse's variant resolution) until a merchant
// explicitly sets them.
export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  compareAtPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weight?: number;

  // Picked from the product's own uploaded media only (validated against
  // productId in the service) — explicit null clears back to no
  // variant-specific image (falls back to the product's featured image).
  @IsOptional()
  @IsInt()
  @IsPositive()
  imageId?: number | null;

  // Bill of Materials — this variant's override recipe, replacing the
  // product-level default for exactly this variant. If provided, replaces
  // this variant's full override row set; omitted leaves it untouched. An
  // empty array clears any override rows back to zero, which means "inherit
  // the product-level default again" — same as never having set an
  // override in the first place (row presence is what makes a variant
  // "overridden," there's no separate flag) — see
  // ProductsService.replaceVariantIngredients. A variant that needs to
  // consume strictly nothing while the product default is non-empty isn't
  // expressible this pass; flagged as a follow-up if a real need shows up.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductIngredientInput)
  ingredients?: ProductIngredientInput[];
}
