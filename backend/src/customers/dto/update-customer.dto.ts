import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  // Same shape the storefront checkout DTO enforces (digits, spaces,
  // hyphens, optional leading +) — kept in sync by hand.
  @IsOptional()
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
