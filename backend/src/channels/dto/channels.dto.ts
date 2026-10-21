import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const ID = { min: 1, max: 191 };
// A marketplace id ends up in a routing key and in outbound URL paths: letters,
// digits and . _ : - only, starting with a letter or digit (so '.' and '..' are
// refused).
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ID_MESSAGE =
  'must start with a letter or digit and contain only letters, digits and . _ : -';

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
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalLocationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ID.max)
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalBrandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ID.max)
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
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
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalLocationId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalBrandId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
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
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalLocationId: string;

  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalBrandId: string | null;

  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(ID.max)
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  externalSiteId: string | null;
}
