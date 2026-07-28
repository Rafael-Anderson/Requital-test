import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginCustomerDto {
  // Phone or email — whichever the customer registered with. Matched
  // against both columns server-side (see CustomerAuthService.login) rather
  // than two separate fields, since the storefront login form is a single
  // input either way.
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}
