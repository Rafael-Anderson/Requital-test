import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class QuoteItemInput {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  @Max(999)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  giftCardAmount?: number;
}

// The pricing-relevant subset of CreatePublicOrderDto. No customer fields at
// all: a quote needs no name, phone, email or street address.
export class QuoteDeliveryDto {
  @IsInt()
  @IsPositive()
  outletId: number;

  @IsIn(['delivery', 'pickup'])
  orderType: 'delivery' | 'pickup';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  discountCode?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemInput)
  items: QuoteItemInput[];
}
