import { IsEmail, MaxLength } from 'class-validator';

// Email-based, same as the staff reset flow (see AuthService.forgotPassword)
// — reused as-is, not reinvented, since it generalizes cleanly for any
// customer who provided an email. A phone-only customer (email is optional
// at registration) has no reset path today — see
// CustomerAuthService.forgotPassword's comment for why that's flagged
// rather than silently worked around.
export class ForgotCustomerPasswordDto {
  @IsEmail()
  @MaxLength(255)
  email: string;
}
