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

// Both phone-shaped fields accept local/bare-country-code/full-E.164 input
// and normalize to E.164; falls back to the raw value when unparseable
// (these fields have no format @Matches, so an unparseable value just gets
// stored as typed, same permissiveness as before — normalization only
// improves the common case, never adds new rejection).
const normalizePhoneField = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (normalizePhoneToE164(value) ?? value) : value;

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
