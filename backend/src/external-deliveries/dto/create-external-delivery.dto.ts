import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { EXTERNAL_DELIVERY_STATUSES } from '../constants';
import type { ExternalDeliveryStatus } from '../constants';

export class CreateExternalDeliveryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  carrier: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vehicleType?: string;

  // What the merchant paid the carrier — distinct from order.deliveryFee
  // (what the customer was charged for Requital's own delivery).
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @IsNotEmpty()
  destination: string;

  @IsOptional()
  @IsIn(EXTERNAL_DELIVERY_STATUSES)
  status?: ExternalDeliveryStatus;
}
