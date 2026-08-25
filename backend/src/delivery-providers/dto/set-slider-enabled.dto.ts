import { IsBoolean } from 'class-validator';

// Merchant-facing toggle only — see slider-account-id.dto.ts for the
// platform-admin-only counterpart that sets the actual Slider customer
// account id. A shop can flip this on before the account id is ever set
// (see SliderSettingsService's "awaiting setup" status).
export class SetSliderEnabledDto {
  @IsBoolean()
  enabled: boolean;
}
