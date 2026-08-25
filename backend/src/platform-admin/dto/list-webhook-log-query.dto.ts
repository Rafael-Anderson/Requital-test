import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ListWebhookLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shopId?: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsIn(['success', 'duplicate', 'rejected', 'failed'])
  result?: 'success' | 'duplicate' | 'rejected' | 'failed';
}
