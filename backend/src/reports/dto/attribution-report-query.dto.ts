import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';

// Deliberately NOT the shared ReportsFilterQueryDto: that one carries status /
// orderType / paymentMode / channel filters, which this report does not apply, and
// accepting-then-ignoring a filter is worse than rejecting it (the page would show
// numbers that look filtered and are not). With whitelist + forbidNonWhitelisted an
// unsupported filter is a 400.
export class AttributionReportQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId?: number;

  // last (default): who got the sale. first: who introduced the customer.
  @IsOptional()
  @IsIn(['first', 'last'])
  model?: 'first' | 'last';
}
