import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ORDER_STATUSES } from '../constants';
import type { OrderStatus } from '../constants';

export class ListOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  // Comma-separated list, e.g. ?statuses=delivered,cancelled — an IN filter,
  // distinct from `status` above (single value). Not applied unless present:
  // the Order History table defaults to showing every status, this exists so
  // a status filter can be added as a UI control later without another
  // backend change.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsIn(ORDER_STATUSES, { each: true })
  statuses?: OrderStatus[];

  // Matches against customer name, customer phone, or order id (when the
  // term is numeric) — case-insensitivity comes from MySQL's default
  // collation, not an explicit Prisma mode (unsupported on this provider).
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // Admin-only filter (branch users are always forced to their own outlet
  // server-side regardless of this value — see resolveOutletFilter). Absent
  // for an admin means "all branches".
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}
