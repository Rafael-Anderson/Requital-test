import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AFFILIATE_STATUSES } from '../constants';

export class UpdateAffiliateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message: 'mobile must contain only digits, spaces, hyphens, and an optional leading +',
  })
  mobile?: string;

  @IsOptional()
  @IsIn(AFFILIATE_STATUSES)
  status?: (typeof AFFILIATE_STATUSES)[number];
}
