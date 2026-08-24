import { IsBoolean, IsOptional } from 'class-validator';

// Backs the Orders > Branch Status tab — a narrow, non-admin-only sibling
// of UpdateOutletDto scoped to just the two accepting-orders toggles, so a
// branch/order_manager staff member can flip them without needing access
// to the full outlet record (name, address, hours, ...) that PATCH
// /outlets/:id exposes. See OutletsController's own comment on why this is
// a separate route rather than a relaxed @Roles on the existing one.
export class UpdateOutletStatusDto {
  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;
}
