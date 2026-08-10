import { Transform, Type } from 'class-transformer';
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
import { normalizePhoneToE164 } from '../../common/normalize';

// See create-outlet.dto.ts's identical helper for the reasoning.
const normalizePhoneField = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (normalizePhoneToE164(value) ?? value) : value;

export class UpdateOutletDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameAr?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Transform(normalizePhoneField)
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
  @Transform(normalizePhoneField)
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
