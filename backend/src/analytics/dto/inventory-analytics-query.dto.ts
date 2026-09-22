import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class InventoryAnalyticsQueryDto {
  // Capped at a year: the window feeds a per-day average, and a multi-year
  // window would average a seasonal business into meaninglessness while
  // scanning far more rollup rows than the answer is worth.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  deadStockDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}
