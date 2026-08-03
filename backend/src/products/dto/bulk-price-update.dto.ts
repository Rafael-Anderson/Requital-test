import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsPositive,
} from 'class-validator';

export class BulkPriceUpdateDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  productIds: number[];

  @IsIn(['price', 'compareAtPrice'])
  field: 'price' | 'compareAtPrice';

  @IsIn(['percentage', 'fixed'])
  mode: 'percentage' | 'fixed';

  // Percentage: e.g. 10 = +10%, -15 = -15%. Fixed: an absolute AED amount,
  // signed. Server always recomputes newPrice from the DB's current price —
  // a client never gets to supply the resulting price directly.
  @IsNumber()
  value: number;
}
