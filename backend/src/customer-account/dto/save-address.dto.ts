import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Same address shape checkout already collects (see
// CreatePublicOrderDto: customerAddress/regionId/area/latitude/longitude) —
// a saved address is just that shape plus a label, kept in
// customer.addresses (see schema.prisma's comment on that field).
export class SaveAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsString()
  @IsNotEmpty()
  address: string;

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
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
