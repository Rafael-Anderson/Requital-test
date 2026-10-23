import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from '../../common/order-limits';

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
  @Max(MAX_LINE_QUANTITY)
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
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => DraftOrderItemInput)
  items?: DraftOrderItemInput[];
}
