import { IsBoolean, IsIn } from 'class-validator';
import { CONSENT_CHANNELS } from '../../customer-crm/consent-wording';

export class SetConsentDto {
  @IsIn(CONSENT_CHANNELS)
  channel!: (typeof CONSENT_CHANNELS)[number];

  // The customer's own answer. There is no "unknown" to send: that state only
  // exists before any answer has been recorded.
  @IsBoolean()
  granted!: boolean;
}
