import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReportsFilterQueryDto } from './reports-filter-query.dto';

export class ListGeneralReportQueryDto extends ReportsFilterQueryDto {
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

  // Matches order id, customer name, or customer phone.
  @IsOptional()
  @IsString()
  search?: string;
}
