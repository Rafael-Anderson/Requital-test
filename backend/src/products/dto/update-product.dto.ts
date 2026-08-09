import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ProductAttributeInput,
  ProductFaqInput,
  ProductImageInput,
  WEIGHT_UNITS,
} from './create-product.dto';
import type { WeightUnit } from './create-product.dto';
import { ProductIngredientInput } from './product-ingredient-input.dto';

// status (Available/Unavailable/Archived) intentionally lives on
// UpdateProductAvailabilityDto instead, via its own PATCH /products/:id/availability
// route — this DTO is the admin-only structural edit, that one is the
// branch-accessible toggle. See products.controller.ts.
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  thumbnail?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sku?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  shortSummary?: string;

  @IsOptional()
  @IsString()
  longSummary?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  compareAtPrice?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  chargeTax?: boolean;

  // Offered in the storefront checkout's "would you like to add any
  // extras?" popup for carts that don't already contain this product.
  @IsOptional()
  @IsBoolean()
  isCheckoutAddon?: boolean;

  // Per-product opt-in for the Variants/Attributes/FAQs sections — see
  // CreateProductDto's own comment.
  @IsOptional()
  @IsBoolean()
  showVariants?: boolean;

  @IsOptional()
  @IsBoolean()
  showAttributes?: boolean;

  @IsOptional()
  @IsBoolean()
  showFaqs?: boolean;

  @IsOptional()
  @IsBoolean()
  continueSellingOutOfStock?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vendor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  productType?: string;

  @IsOptional()
  @IsBoolean()
  physicalProduct?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsIn(WEIGHT_UNITS)
  weightUnit?: WeightUnit;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  dimensions?: string;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  // Gift Cards — see CreateProductDto's own comment.
  @IsOptional()
  @IsBoolean()
  isGiftCard?: boolean;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsPositive({ each: true })
  giftCardDenominations?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  giftCardCustomAmountMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  giftCardCustomAmountMax?: number;

  // Bill of Materials — see CreateProductDto's own comment. If provided
  // (even an empty array), replaces the full product-level default recipe;
  // omitted leaves it untouched — same "replaces the full set" convention
  // as images/collectionIds/tags below.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductIngredientInput)
  ingredients?: ProductIngredientInput[];

  // If provided (even an empty array), replaces the full gallery — same
  // "replaces the full set" convention as collectionIds/tags below. Omitted
  // leaves the existing gallery and thumbnail untouched.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageInput)
  images?: ProductImageInput[];

  // If provided (even an empty array), replaces the full attribute list —
  // same convention as images above.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeInput)
  attributes?: ProductAttributeInput[];

  // If provided (even an empty array), replaces the full FAQ list.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductFaqInput)
  faqs?: ProductFaqInput[];

  // If provided, replaces the full collection set — must stay non-empty.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  collectionIds?: number[];

  // If provided, replaces the full tag set.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // Only regenerated when explicitly provided — editing other fields (e.g.
  // renaming the product) deliberately does NOT silently change an
  // already-published slug URL. An explicit value that collides with
  // another product in this shop is rejected (ConflictException), unlike
  // create's auto-generate path, which disambiguates instead.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;
}
