import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { AFFILIATE_CODE_STATUSES, COMMISSION_TYPES } from '../constants';

export class UpdateAffiliateCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  promotionFor?: string;

  @IsOptional()
  @IsIn(AFFILIATE_CODE_STATUSES)
  status?: (typeof AFFILIATE_CODE_STATUSES)[number];

  @IsOptional()
  @IsIn(COMMISSION_TYPES)
  commissionType?: (typeof COMMISSION_TYPES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionValue?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
