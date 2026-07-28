import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  // Same shape as the storefront checkout's phone field (see
  // CreatePublicOrderDto.customerPhone) — registration and guest checkout
  // must accept the same phone format since a registration is a claim
  // against a row checkout could equally have created.
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message: 'phone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  phone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes
  password: string;
}
