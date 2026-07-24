import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

// from/to both optional — omitting either falls back to the default 30-day
// window ending today (see DashboardService.resolveRange). outletId is
// admin-only drill-down (branch users are always forced to their own
// outlet server-side); omitted for an admin means aggregated across every
// outlet.
export class DashboardQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}
