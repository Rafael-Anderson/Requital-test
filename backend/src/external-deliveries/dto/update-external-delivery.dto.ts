import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { EXTERNAL_DELIVERY_STATUSES } from '../constants';
import type { ExternalDeliveryStatus } from '../constants';

export class UpdateExternalDeliveryDto {
  @IsOptional()
  @IsIn(EXTERNAL_DELIVERY_STATUSES)
  status?: ExternalDeliveryStatus;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  vehicleType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  destination?: string;
}
