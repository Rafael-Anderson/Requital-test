import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

// Query for POST /products/import/preview and /confirm. `source` picks the
// column mapping; omitted means the Requital CSV format, unchanged.
export const IMPORT_SOURCES = ['requital', 'shopify', 'salla', 'zid'] as const;

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

  // Shopify, Salla and Zid only: the collection new products are placed in (a Shopify product
  // export has no collections). Validated against the caller's shop.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  collectionId?: number;

  // Shopify, Salla and Zid only: what to do with a product that already exists.
  @IsOptional()
  @IsIn(['update', 'skip'])
  onExisting?: 'update' | 'skip';

  // Shopify, Salla and Zid only: after the import, copy each listed remote
  // image into Requital's own storage (queued, never done inside the request).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === '1' || value === true
      ? true
      : value === 'false' || value === '0' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  copyImages?: boolean;
}
