import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { DISCOUNT_APPLIES_TO, DISCOUNT_TYPES } from '../discount-constants';
import type { DiscountAppliesTo, DiscountType } from '../discount-constants';

export class CreateDiscountDto {
  // Same shape as affiliate codes (CreateAffiliateCodeDto) — uppercased and
  // compared as such in the service; this pattern just constrains what a
  // merchant can type in the first place.
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, {
    message:
      'code must be 3-32 characters: letters, numbers, hyphens, or underscores',
  })
  code: string;

  @IsIn(DISCOUNT_TYPES)
  type: DiscountType;

  // Required for PERCENTAGE/FIXED_AMOUNT, must be absent for FREE_SHIPPING —
  // enforced in DiscountsService (cross-field, not expressible as a plain
  // decorator), same convention as BioLinksService.assertFieldsMatchType.
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
  categoryIds?: number[];

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
