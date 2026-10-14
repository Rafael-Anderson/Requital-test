import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const ID = { min: 1, max: 191 };

export class CreateChannelConnectionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  provider: string;

  @IsOptional()
  @IsString()
  @MinLength(ID.min)
  @MaxLength(ID.max)
  externalLocationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ID.max)
  externalBrandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ID.max)
  externalSiteId?: string;

  // WRITE-ONLY. Flat string map; encrypted at rest, never returned.
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  // WRITE-ONLY.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  webhookSecret?: string;
}

// provider and outletId are immutable after create. null clears a field.
export class UpdateChannelConnectionDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MinLength(ID.min)
  @MaxLength(ID.max)
  externalLocationId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  externalBrandId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  externalSiteId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsObject()
  credentials?: Record<string, string> | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  webhookSecret?: string | null;
}

export class SetChannelEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

export class CreateChannelMappingDto {
  @IsString()
  @MinLength(ID.min)
  @MaxLength(ID.max)
  externalItemId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  provider: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalName?: string;
}

export class ResolveUnmappedItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;
}

export class ListChannelOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  @IsOptional()
  @IsIn([
    'needs_mapping',
    'pending_acceptance',
    'accepted',
    'rejected',
    'cancelled_upstream',
  ])
  state?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class RejectChannelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

// What platform staff confirmed with the marketplace. All three are required
// keys (brand/site may be an explicit null) so staff state the whole tuple.
export class VerifyChannelLocationDto {
  @IsString()
  @MinLength(ID.min)
  @MaxLength(ID.max)
  externalLocationId: string;

  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  externalBrandId: string | null;

  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  externalSiteId: string | null;
}
