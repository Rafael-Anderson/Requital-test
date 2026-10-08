import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

// productId (+ optional variantId) OR ingredientId, enforced by
// ProductsService.resolveShadowStockTarget (same XOR as every stock endpoint).
export class SetReorderPointDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ingredientId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId: number;

  // null clears it. Omitting the key is a 400 (a clear must be explicit), so the
  // whitelist pipe cannot turn "clear" into "left unchanged".
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderPoint: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  reorderQuantity: number | null;
}

export class ReorderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}

export class CreateDraftPosDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId: number;

  // Limit to one supplier's suggestion (every currency group of it).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;
}
