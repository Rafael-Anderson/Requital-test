import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';
import { ORDER_STATUSES } from '../../orders/constants';
import type { OrderStatus } from '../../orders/constants';

// Same filter set as ReportsFilterQueryDto minus dateFrom/dateTo, which
// Monthly Report replaces with a single `month` — see
// ReportsService.resolveMonthRange for how that becomes the same
// dateFrom/dateTo the General Report query already understands. Hand-
// duplicated rather than extending/omitting from ReportsFilterQueryDto:
// this project doesn't use @nestjs/mapped-types anywhere else, and these
// are the same five lines CreateProductDto/UpdateProductDto already
// duplicate for the same reason.
export class MonthlyReportFilterDto {
  // "YYYY-MM", e.g. "2026-07".
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  month: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId?: number;

  @IsOptional()
  @IsIn(['delivery', 'pickup'])
  orderType?: string;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  paymentMode?: string;

  @IsOptional()
  @IsString()
  channel?: string;
}
