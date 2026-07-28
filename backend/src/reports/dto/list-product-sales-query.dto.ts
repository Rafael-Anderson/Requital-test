import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReportsFilterQueryDto } from './reports-filter-query.dto';

export const PRODUCT_SALES_SORT_FIELDS = [
  'name',
  'currentPrice',
  'orderCount',
  'totalQuantity',
  'totalSalePrice',
] as const;
export type ProductSalesSortField = (typeof PRODUCT_SALES_SORT_FIELDS)[number];

export class ListProductSalesQueryDto extends ReportsFilterQueryDto {
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
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(PRODUCT_SALES_SORT_FIELDS)
  sortBy?: ProductSalesSortField = 'totalSalePrice';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc' = 'desc';
}
