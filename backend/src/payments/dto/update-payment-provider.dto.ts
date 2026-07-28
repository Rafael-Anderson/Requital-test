import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdatePaymentProviderDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Field-name/value validation is provider-specific (see
  // PROVIDER_CREDENTIAL_FIELDS) — checked in PaymentSettingsService rather
  // than here, same tradeoff as UpdateThemeDto.colors.
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}
