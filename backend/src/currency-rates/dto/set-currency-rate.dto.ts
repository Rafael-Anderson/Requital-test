import { Type } from 'class-transformer';
import { IsNumber, IsPositive, IsString, Length, Max } from 'class-validator';

export class SetCurrencyRateDto {
  // ISO 4217. Not restricted to the shop-facing allowlist (update-shop.dto.ts's
  // SUPPORTED_CURRENCIES): a platform admin needs to be able to stage a rate for
  // a currency BEFORE it is offered to merchants, which is the order A6 depends
  // on.
  @IsString()
  @Length(3, 3, { message: 'quoteCurrency must be a 3-letter ISO 4217 code' })
  quoteCurrency: string;

  // Units of quoteCurrency per 1 USD. Positive and finite — a zero or negative
  // rate is not a slow conversion, it is a corrupted one, and it would silently
  // zero or invert every figure derived from it.
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(1000000)
  rate: number;
}
