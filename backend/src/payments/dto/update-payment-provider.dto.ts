import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { SanitizeCredential } from '../../common/credential-sanitize';

export class UpdatePaymentProviderDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Field-name/value validation is provider-specific (see
  // PROVIDER_CREDENTIAL_FIELDS) — checked in PaymentSettingsService rather
  // than here, same tradeoff as UpdateThemeDto.colors.
  @IsOptional()
  @IsObject()
  @SanitizeCredential()
  credentials?: Record<string, string>;
}
