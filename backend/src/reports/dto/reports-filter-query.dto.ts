import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { ORDER_STATUSES } from '../../orders/constants';
import type { OrderStatus } from '../../orders/constants';

// Shared by every reports endpoint — General Report's stat cards + order
// list, and Product Sale Report, all filter on the same set. paymentMode
// and channel are plain string equality against order.paymentMethod/
// order.channel rather than a closed enum: paymentMethod is only ever set
// by storefront orders today (admin-entered orders leave it null) and
// channel has no real attribution system behind it yet — see
// reports.service.ts for why these aren't validated against a fixed list.
export class ReportsFilterQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // Admin-only filter (branch users don't reach this module at all — see
  // ReportsController).
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
