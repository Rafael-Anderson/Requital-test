import { Matches } from 'class-validator';

// Same phone shape as registration and checkout.
export class SendPhoneOtpDto {
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message:
      'phone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  phone: string;
}
