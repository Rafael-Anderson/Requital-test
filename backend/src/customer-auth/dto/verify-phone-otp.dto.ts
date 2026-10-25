import { Matches } from 'class-validator';
import { SendPhoneOtpDto } from './send-phone-otp.dto';

export class VerifyPhoneOtpDto extends SendPhoneOtpDto {
  @Matches(/^[0-9]{6}$/, { message: 'code must be 6 digits' })
  code: string;
}
