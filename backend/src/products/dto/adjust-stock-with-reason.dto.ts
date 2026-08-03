import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { ADJUSTMENT_REASONS } from '../stock-movement.constants';

// productId (+ optional variantId) OR ingredientId — see TransferStockDto's
// comment for why this is XOR-enforced in the service, not here.
export class AdjustStockWithReasonDto {
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
  // user — always forced to their own outlet, same as adjustStock/bulk-adjust.
  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  // Signed — positive for restocks, negative for shrinkage/damage/loss.
  @IsInt()
  delta: number;

  @IsIn(ADJUSTMENT_REASONS)
  reason: (typeof ADJUSTMENT_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
