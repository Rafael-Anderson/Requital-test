import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ListProductsQueryDto {
  // Which outlet's stock counts to attach to each product. Admin-only
  // (branch users are always forced to their own outlet server-side); if
  // omitted for an admin, products are returned without stock figures.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;
}
