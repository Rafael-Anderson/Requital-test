import { IsNotEmpty, IsString } from 'class-validator';
import { SanitizeCredential } from '../../common/credential-sanitize';

// Both fields required together, not a partial-merge like payment
// providers' credential dict — WhatsApp only ever has this one fixed
// 2-field shape, so there's no ambiguity to support around leaving one
// field untouched across saves. Pasted invisible characters are removed before
// validation; the shape rules (digits-only id, no whitespace in the token) are
// checked in the service so the 400 can name each field.
export class SetWhatsAppCredentialsDto {
  @SanitizeCredential()
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @SanitizeCredential()
  @IsString()
  @IsNotEmpty()
  accessToken: string;
}
