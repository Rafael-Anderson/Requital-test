import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { DISCOUNT_APPLIES_TO, DISCOUNT_KINDS, DISCOUNT_TYPES } from '../discount-constants';
import type { DiscountAppliesTo, DiscountKind, DiscountType } from '../discount-constants';

export class UpdateDiscountDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, {
    message:
      'code must be 3-32 characters: letters, numbers, hyphens, or underscores',
  })
  code?: string;

  @IsOptional()
  @IsIn(DISCOUNT_KINDS)
  discountType?: DiscountKind;

  @IsOptional()
  @IsIn(DISCOUNT_TYPES)
  type?: DiscountType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPurchaseAmount?: number;

  @IsOptional()
  @IsIn(DISCOUNT_APPLIES_TO)
  appliesTo?: DiscountAppliesTo;

  // If provided, replaces the full product/collection eligibility set — same
  // "replace on write" convention as UpdateProductDto.collectionIds.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  productIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  collectionIds?: number[];

  @IsOptional()
  @IsInt()
  @IsPositive()
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  usageLimitPerCustomer?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
