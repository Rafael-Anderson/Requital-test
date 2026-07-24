import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class UpdateDeliveryFeeDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee: number;
}
