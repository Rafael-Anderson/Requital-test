import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Same shape as ListCustomersQueryDto minus the sort fields — this table has
// two columns worth showing and is always read newest-first, so there is no
// sort control to validate. Add one when a merchant asks, not before.
export class ListNewsletterSubscribersQueryDto {
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

  // Matches against email.
  @IsOptional()
  @IsString()
  search?: string;
}
