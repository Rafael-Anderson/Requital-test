import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// Shared by the admin-authenticated POST /shop/discounts/validate (used by
// the draft-order builder) and the public POST /public/:shopSlug/discounts/validate
// (used by storefront cart/checkout) — see DiscountsController and
// PublicController. customerId is only ever supplied by the admin path
// today (a draft order's resolved customer); the public path always omits
// it, so per-customer usage limits aren't enforced pre-checkout for a guest
// who hasn't been matched to a customer record yet — only at actual order
// creation, once findOrCreateForOrder has run inside the same transaction.
export class ValidateDiscountDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cartSubtotal: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  productIds?: number[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  collectionIds?: number[];

  @IsOptional()
  @IsInt()
  @IsPositive()
  customerId?: number;

  // Preferred over productIds/collectionIds: with the cart's lines the server
  // derives eligibility and the amount exactly as order creation will.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ValidateDiscountItemDto)
  items?: ValidateDiscountItemDto[];
}

// One cart line, for an exact eligibility + amount. The server prices it (the
// same resolver order creation uses); `priceOverride` is honoured only on the
// admin draft-order route and stripped from the public one.
export class ValidateDiscountItemDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  productId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  variantId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  giftCardAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceOverride?: number;
}
