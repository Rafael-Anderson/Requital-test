import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class DraftOrderItemInput {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;
}

export class UpdateDraftOrderDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  outletId?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customerName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customerAddress?: string;

  // The region, by id. Options come from GET /regions (staff) or
  // GET /public/:shopSlug/regions (storefront).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId?: number;

  // DEPRECATED alias: the region's English name. Accepted only while older
  // frontends are still deployed; `regionId` supersedes it. Resolved against
  // the shop's own country by RegionsService, never against a global list.
  @IsOptional()
  @IsString()
  @MaxLength(191)
  emirate?: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsIn(['delivery', 'pickup'])
  orderType?: string;

  // Explicit null clears an already-applied discount; omitted leaves it
  // untouched — same "null clears, undefined leaves alone" convention as
  // BioPageConfig's logoUrl/backgroundUrl.
  @IsOptional()
  discountCode?: string | null;

  @IsOptional()
  @IsString()
  notes?: string;

  // If provided, replaces the full item list — same convention as
  // UpdateProductDto.collectionIds.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DraftOrderItemInput)
  items?: DraftOrderItemInput[];
}
