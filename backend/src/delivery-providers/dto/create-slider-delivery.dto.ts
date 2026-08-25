import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, Min } from 'class-validator';
import {
  SLIDER_VEHICLE_TYPES,
  type SliderVehicleType,
} from '../slider/slider.constants';

export class CreateSliderDeliveryDto {
  @IsIn(SLIDER_VEHICLE_TYPES)
  vehicleType: SliderVehicleType;

  // ISO 8601 UTC, at least 30 minutes out — validated for real in
  // slider-caps.ts's assertScheduleAtOk (needs "now" to compare against,
  // which a class-validator decorator can't express). Omitted/null means
  // immediate dispatch.
  @IsOptional()
  @IsISO8601()
  scheduleAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  driverTip?: number;
}
