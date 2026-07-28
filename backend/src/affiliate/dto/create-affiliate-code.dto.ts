import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, Min, MaxLength } from 'class-validator';
import { COMMISSION_TYPES } from '../constants';

export class CreateAffiliateCodeDto {
  @IsInt()
  @IsPositive()
  affiliateId: number;

  // Shareable-URL-safe: letters, digits, hyphens, underscores only.
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, {
    message: 'code must be 3-32 characters of letters, digits, hyphens, or underscores',
  })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  promotionFor?: string;

  @IsIn(COMMISSION_TYPES)
  commissionType: (typeof COMMISSION_TYPES)[number];

  @IsNumber()
  @Min(0)
  commissionValue: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
