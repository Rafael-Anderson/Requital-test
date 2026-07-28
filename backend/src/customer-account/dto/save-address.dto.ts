import { IsIn, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { EMIRATES } from '../../orders/constants';

// Same address shape checkout already collects (see
// CreatePublicOrderDto: customerAddress/emirate/area/latitude/longitude) —
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

  @IsIn(EMIRATES)
  emirate: string;

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
