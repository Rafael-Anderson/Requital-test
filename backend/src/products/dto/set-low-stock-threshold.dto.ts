import { IsInt, IsOptional, IsPositive, Min } from 'class-validator';

// productId (+ optional variantId) OR ingredientId — same XOR shape as
// AdjustStockWithReasonDto/TransferStockDto, enforced in the service
// (ProductsService.assertStockTarget), not here.
export class SetLowStockThresholdDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  productId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  ingredientId?: number;

  // Required for an admin (not scoped to one outlet). Ignored for a branch
  // user — always forced to their own outlet, same as every other stock
  // endpoint.
  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  // null explicitly turns the alert off — @IsOptional alone would let the
  // field be omitted, but a merchant clearing a previously-set threshold
  // needs to be able to send `null` and have it actually persist, not be
  // silently dropped by whitelist validation the way an omitted field
  // would be.
  @IsOptional()
  @Min(0)
  @IsInt()
  lowStockThreshold: number | null;
}
