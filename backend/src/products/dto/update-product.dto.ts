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
import { PRODUCT_STATUSES } from './create-product.dto';
import type { ProductStatus } from './create-product.dto';

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
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  // If provided, replaces the full category set — must stay non-empty.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  categoryIds?: number[];

  // If provided, replaces the full tag set.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
