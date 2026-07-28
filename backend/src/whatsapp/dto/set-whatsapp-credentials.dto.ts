import { IsNotEmpty, IsString } from 'class-validator';

// Both fields required together, not a partial-merge like payment
// providers' credential dict — WhatsApp only ever has this one fixed
// 2-field shape, so there's no ambiguity to support around leaving one
// field untouched across saves.
export class SetWhatsAppCredentialsDto {
  @IsString()
  @IsNotEmpty()
  phoneNumberId: string;

  @IsString()
  @IsNotEmpty()
  accessToken: string;
}
