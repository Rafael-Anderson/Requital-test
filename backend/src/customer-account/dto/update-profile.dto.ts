import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Self-service profile fields only — name/email/phone. Nothing here touches
// anything admin-only on the Customer CRM record (there are no
// tags/segments fields on this model today, but if any are added later,
// they belong on the admin-only UpdateCustomerDto in customers/, not this one).
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message:
      'phone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  phone?: string;

  // Required only when the email of an account that already has a verified one
  // is being changed. Never stored.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword?: string;
}
