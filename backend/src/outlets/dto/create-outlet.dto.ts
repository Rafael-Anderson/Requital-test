import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOutletDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameAr?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsapp?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  emirate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  // Shape: { mon: { open: "09:00", close: "18:00", closed: false }, ... }
  @IsOptional()
  @IsObject()
  businessHours?: Record<
    string,
    { open: string; close: string; closed: boolean }
  >;

  @IsOptional()
  @IsBoolean()
  closedOverride?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryRadiusKm?: number;
}
