import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

// Query for POST /products/import/preview and /confirm. `source` picks the
// column mapping; omitted means the Requital CSV format, unchanged.
export const IMPORT_SOURCES = ['requital', 'shopify'] as const;

export class ImportQueryDto {
  @IsOptional()
  @IsIn(IMPORT_SOURCES)
  source?: (typeof IMPORT_SOURCES)[number];

  // Stock quantities are written to this outlet only (validated against the
  // caller's shop in the service before anything is read or written).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  // Shopify only: the collection new products are placed in (a Shopify product
  // export has no collections). Validated against the caller's shop.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  collectionId?: number;

  // Shopify only: what to do with a product that already exists.
  @IsOptional()
  @IsIn(['update', 'skip'])
  onExisting?: 'update' | 'skip';
}
