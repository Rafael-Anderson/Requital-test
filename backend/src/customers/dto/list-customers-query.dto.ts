import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const CUSTOMER_SORT_FIELDS = [
  'name',
  'phone',
  'orderCount',
  'lifetimeValue',
  'lastOrderDate',
] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export class ListCustomersQueryDto {
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

  // Matches against name or phone.
  @IsOptional()
  @IsString()
  search?: string;

  // Only customers carrying this tag (the tag must belong to the caller's shop;
  // another shop's id simply matches nothing).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tagId?: number;

  // Only the members of this saved segment (evaluated live).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  segmentId?: number;

  @IsOptional()
  @IsIn(CUSTOMER_SORT_FIELDS)
  sortBy?: CustomerSortField = 'lastOrderDate';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';
}
