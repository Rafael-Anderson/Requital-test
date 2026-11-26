import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MANUAL_PAYMENT_METHODS } from '../draft-order-constants';

export class MarkDraftPaidDto {
  @IsIn(MANUAL_PAYMENT_METHODS)
  method: (typeof MANUAL_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;
}
