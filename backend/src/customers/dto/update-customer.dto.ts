import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhoneToE164 } from '../../common/normalize';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  // Same shape the storefront checkout DTO enforces (digits, spaces,
  // hyphens, optional leading +) — kept in sync by hand. Normalized to
  // E.164 first (accepts local/bare-country-code/full-E.164 input alike,
  // same as signup's phone field) so the same real phone number typed in a
  // different format doesn't collide with customer.phone's
  // @@unique([shopId, phone]) as two separate records; the normalized
  // +971xxxxxxxxx shape still satisfies this regex unchanged.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? (normalizePhoneToE164(value) ?? value) : value,
  )
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message:
      'phone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsDateString()
  birthday?: string;
}
