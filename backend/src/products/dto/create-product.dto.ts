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
  MaxLength,
} from 'class-validator';

export const PRODUCT_STATUSES = [
  'Available',
  'Unavailable',
  'Archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

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
}
