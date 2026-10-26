import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EARN_BASES, type EarnBase } from '../loyalty-math';

// Every field optional: a save merges over what is stored (or the disabled
// defaults). Rates are decimal strings, validated in the service (parseRate).
export class SaveLoyaltyProgramDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Allow()
  earnRate?: unknown;

  @IsOptional()
  @IsIn(EARN_BASES)
  earnBase?: EarnBase;

  @IsOptional()
  @IsBoolean()
  redeemEnabled?: boolean;

  @IsOptional()
  @Allow()
  redeemPointsPerUnit?: unknown;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  redeemMinPoints?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  redeemStepPoints?: number;

  // null clears the per-redemption cap.
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  redeemMaxPoints?: number | null;
}

export class AdjustLoyaltyDto {
  // Signed whole points; never zero.
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  points!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,36}$/)
  idempotencyKey?: string;
}

export class RedeemLoyaltyDto {
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  points!: number;

  // A retry of the SAME click carries the same key and is applied once.
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,36}$/)
  idempotencyKey!: string;
}
