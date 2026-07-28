// 'order_manager': shop-wide (not outlet-pinned, unlike 'branch') access to
// the Orders/Draft Orders domain only — no pricing, catalog, or settings
// access. 'viewer': shop-wide read-only — reports, orders, customers, but
// no mutation of anything. Both are additive on top of the original
// admin/branch split; 'branch' keeps its existing outlet-pinned semantics
// unchanged (see resolveOutletFilter) rather than being folded into these.
export type UserRole = 'admin' | 'branch' | 'order_manager' | 'viewer';

// Resolved by AuthGuard from the authenticated request (re-read from the DB
// on every request, not trusted off the JWT payload — see auth.guard.ts) and
// handed to controllers via @CurrentUser(). Every tenant-scoped query must
// be built from this, never a client-supplied shopId/outletId: `role` and
// `outletId` are what the branch-user outlet-override rule is enforced
// against in each module's service (branch users always get forced to their
// own outletId regardless of what a request asks for).
export interface TenantContext {
  userId: number;
  shopId: number;
  role: UserRole;
  outletId: number | null; // always null for admin, always set for branch
}
