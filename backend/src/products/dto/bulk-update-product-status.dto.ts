import { ArrayNotEmpty, ArrayMaxSize, IsArray, IsIn, IsInt, IsPositive } from 'class-validator';
import { PRODUCT_STATUSES } from './create-product.dto';
import type { ProductStatus } from './create-product.dto';

export class BulkUpdateProductStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  productIds: number[];

  @IsIn(PRODUCT_STATUSES)
  status: ProductStatus;
}
