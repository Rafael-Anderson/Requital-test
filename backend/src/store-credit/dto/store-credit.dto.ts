import { Allow, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../shop/dto/update-shop.dto';

export class AdjustStoreCreditDto {
  // Credit lives in the currency it was issued in. Required, never defaulted.
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  // A positive amount; the direction says whether it is added or taken off.
  // Validated against the currency's decimals by parseAdminAmount (a string or a
  // number is accepted, anything else is a 400).
  @Allow()
  amount!: unknown;

  @IsIn(['grant', 'deduct'])
  direction!: 'grant' | 'deduct';

  // Why: required, because this is money. Kept on the ledger row.
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  // A retry of the SAME click carries the same key and is applied once.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  idempotencyKey?: string;
}
