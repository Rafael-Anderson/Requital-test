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
import { ProductIngredientInput } from './product-ingredient-input.dto';

export const PRODUCT_STATUSES = [
  'Available',
  'Unavailable',
  'Archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const WEIGHT_UNITS = ['kg', 'g', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export class ProductImageInput {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class ProductAttributeInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  value: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class ProductFaqInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  question: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  answer: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  // URL/path to an already-hosted image. File upload handling is not part
  // of Phase 1 (no storage integration exists yet).
  @IsString()
  @IsNotEmpty()
  thumbnail: string;

  @IsString()
  @IsNotEmpty()
  sku: string;

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

  // Shown struck-through as a "was" price when set — display only, never
  // part of order total math.
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

  // Per-product opt-in for the Variants/Attributes/FAQs sections of the
  // admin product form — see schema.prisma's comment on product.showVariants.
  @IsOptional()
  @IsBoolean()
  showVariants?: boolean;

  @IsOptional()
  @IsBoolean()
  showAttributes?: boolean;

  @IsOptional()
  @IsBoolean()
  showFaqs?: boolean;

  // "Continue selling when out of stock" — only meaningful alongside
  // trackInventory; ignored otherwise (untracked products never block on
  // stock regardless).
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

  // Off means digital/service — hides weight/dimensions in the UI and
  // skips shipping entirely at checkout (no fulfillment behavior actually
  // branches on this yet, matching the task's descoped shipping-rate scope).
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

  // Single free-text field, not Shopify's full package-profile system
  // (explicitly descoped in the task) — e.g. "20 x 15 x 10 cm".
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dimensions?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  // Off by default — many florists make bouquets to order and don't want
  // stock counts enforced.
  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  // Stock counts live per-outlet now (see outletstock), not on the catalog
  // entry — set them via PATCH /products/stock/bulk-adjust after creating
  // the product.

  // Gift Cards — see schema.prisma's comment on product.isGiftCard. `price`
  // above still has to be set (a positive placeholder) to satisfy the
  // column's own NOT NULL constraint, but is ignored for a gift-card
  // product — the real amount is always the shopper's chosen denomination/
  // custom amount at order time.
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

  // Bill of Materials — product-level default recipe (always variantId:
  // null server-side; a variant-specific override is set separately via
  // UpdateVariantDto once the variant itself exists — see VariantsSection
  // in the admin frontend). Omitted entirely (every caller that predates
  // this feature) means "no recipe defined," fully backward compatible —
  // ProductsService.consumeForOrderItems is simply a no-op for this
  // product. Full-replace on update, same convention as images/
  // categoryIds/tags — see ProductsService.replaceProductIngredients.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductIngredientInput)
  ingredients?: ProductIngredientInput[];

  // Media gallery — when provided (non-empty), images[0].url becomes the
  // canonical `thumbnail` (see ProductsService), overriding the legacy
  // `thumbnail` field above. Omitted entirely (the common case for every
  // caller that predates this feature, incl. every existing e2e fixture)
  // leaves `thumbnail` as the single source of truth, unchanged.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageInput)
  images?: ProductImageInput[];

  // Informational, non-purchasable facts (e.g. Material: Cotton) — distinct
  // from options/variants, see ProductAttributeInput's own comment. Omitted
  // leaves it empty; full-replace on update, same convention as images.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeInput)
  attributes?: ProductAttributeInput[];

  // Per-product FAQ list, admin-editable, rendered on the storefront PDP
  // when this product's own showFaqs is on. Same convention as attributes above.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductFaqInput)
  faqs?: ProductFaqInput[];

  // At least one category is required (SRS FR-4.2).
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  categoryIds: number[];

  // Free-form tags, e.g. "roses", "boxes" (SRS FR-4.2, distinct from category).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // Auto-derived from name if omitted (see ProductsService.resolveUniqueSlug).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by hyphens',
  })
  slug?: string;

  // Falls back to name/description on the storefront if left unset — see
  // public/PublicService's product metadata fallback.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  metaDescription?: string;
}
