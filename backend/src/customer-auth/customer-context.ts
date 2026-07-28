// Resolved by CustomerAuthGuard from a verified customer bearer token,
// re-read from the DB on every request (same discipline as TenantContext /
// AuthGuard for staff — see common/tenant-context.ts). A customer account is
// tied to exactly one shop (the [shopId, phone] row it was registered
// against), never global — every customer-account query must be built from
// this, never a client-supplied id.
export interface CustomerContext {
  customerId: number;
  shopId: number;
}
