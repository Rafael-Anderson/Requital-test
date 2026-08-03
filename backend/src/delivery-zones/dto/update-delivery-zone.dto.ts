import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateDeliveryZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
