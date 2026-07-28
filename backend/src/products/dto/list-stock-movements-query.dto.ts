import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { STOCK_MOVEMENT_TYPES } from '../stock-movement.constants';

export class ListStockMovementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  productId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  ingredientId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId?: number;

  @IsOptional()
  @IsIn(STOCK_MOVEMENT_TYPES)
  type?: (typeof STOCK_MOVEMENT_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pageSize?: number;
}
