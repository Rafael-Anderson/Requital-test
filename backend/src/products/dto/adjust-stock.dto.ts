import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  ValidateNested,
} from 'class-validator';

class StockAdjustment {
  @IsInt()
  @IsPositive()
  productId: number;

  // When set, adjusts this variant's own outletvariantstock row instead of
  // the parent product's outletstock row — see ProductsService.adjustStock.
  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  // Signed delta applied to current stockQuantity — positive for restocks,
  // negative for shrinkage/damage corrections.
  @IsInt()
  delta: number;
}

export class AdjustStockDto {
  // Required for an admin (they aren't scoped to one outlet). Ignored for a
  // branch user — the service always forces their own outlet.
  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StockAdjustment)
  adjustments: StockAdjustment[];
}
