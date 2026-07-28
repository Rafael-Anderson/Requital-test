import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ListProductsQueryDto {
  // Which outlet's stock counts to attach to each product. Admin-only
  // (branch users are always forced to their own outlet server-side); if
  // omitted for an admin, products are returned without stock figures.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  // findOne only (see ProductsController) — attaches a per-outlet stock
  // breakdown (product-level and, if variants exist, per-variant) instead of
  // the single-outlet figure `outletId` above resolves. Powers the product
  // edit form's inventory table, which needs every outlet's quantity at
  // once, not just the currently-selected branch's.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allOutlets?: boolean;
}
