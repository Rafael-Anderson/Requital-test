import { IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';
import { EMIRATES } from '../../orders/constants';

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsIn(EMIRATES)
  emirate?: string;

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
