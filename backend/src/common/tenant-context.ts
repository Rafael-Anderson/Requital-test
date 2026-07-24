export type UserRole = 'admin' | 'branch';

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
