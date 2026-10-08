import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// A phone the driver can be called on and WhatsApped. Digits with an optional
// leading +, spaces and dashes tolerated, 7 to 20 digits. Stored trimmed.
const PHONE = /^\+?[0-9][0-9 -]{5,30}[0-9]$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateDriverDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @Transform(trim)
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone: string;

  // Admins pick the outlet; a branch user's own outlet always wins.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}

export class UpdateDriverDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListDriversQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}
