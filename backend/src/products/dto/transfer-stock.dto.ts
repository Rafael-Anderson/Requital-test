import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

// productId (+ optional variantId) OR ingredientId — exactly one, never
// both. Both left optional at the DTO level and the XOR enforced in
// ProductsService (see assertStockTarget) rather than a custom
// class-validator decorator, same "invariant enforced in the service, not
// the DTO" convention as every other discriminated-field shape in this
// codebase (e.g. BioLinksService's type/url/productId/categoryId).
export class TransferStockDto {
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

  @IsInt()
  @IsPositive()
  fromOutletId: number;

  @IsInt()
  @IsPositive()
  toOutletId: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
