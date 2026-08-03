import type { UserRole } from './tenant-context';

// Fixed, code-defined vocabulary — deliberately not a free-form string an
// admin can invent, so every permission that can be granted is guaranteed
// to correspond to a real enforcement point somewhere in the app. One
// permission per capability actually gated across the tenant-isolation
// audit; several call sites share a permission when they're the same
// logical capability (e.g. every orders write endpoint shares
// 'orders.manage').
export const ALL_PERMISSIONS = [
  'orders.view',
  'orders.manage',
  'dashboard.view',
  'products.view',
  'products.manage_stock',
  'ingredients.view',
  'search.use',
  'outlets.view_own',
  'delivery_zones.view',
  'payments.generate_link',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value);
}

// What each of the existing 4 shop-wide tiers already implies, expressed in
// the new permission vocabulary. Consulted ONLY when a useroutletrole
// override exists for the request's (user, outlet) — see
// BranchRolesService.resolveEffectivePermissions — so this changes nothing
// for any shop that has never assigned an override. It's also the actual
// security guarantee behind "restrict-only": a per-outlet override's
// permissions are intersected against this set, so no override can ever
// grant a user more than their shop-wide role already permits.
const ADMIN_PERMISSIONS = new Set<Permission>(ALL_PERMISSIONS);

// Matches everything the 'branch' role can reach today per the tenant-
// isolation audit (orders, dashboard, products stock ops, ingredients read,
// search, own-outlet read, delivery zones read, payment links) — i.e. the
// full vocabulary, since the vocabulary was built from exactly branch's
// existing reach plus admin-only actions that aren't in scope here.
const BRANCH_PERMISSIONS = new Set<Permission>(ALL_PERMISSIONS);

// Shop-wide (not outlet-pinned), scoped to the Orders domain only — no
// pricing/catalog/settings access, per the role's existing definition.
const ORDER_MANAGER_PERMISSIONS = new Set<Permission>([
  'orders.view',
  'orders.manage',
  'search.use',
]);

// Shop-wide read-only — reports/orders/customers, no mutations anywhere.
const VIEWER_PERMISSIONS = new Set<Permission>([
  'orders.view',
  'dashboard.view',
  'products.view',
  'ingredients.view',
  'search.use',
  'outlets.view_own',
  'delivery_zones.view',
]);

const BASE_PERMISSIONS_BY_ROLE: Record<UserRole, Set<Permission>> = {
  admin: ADMIN_PERMISSIONS,
  branch: BRANCH_PERMISSIONS,
  order_manager: ORDER_MANAGER_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

export function basePermissionsFor(role: UserRole): Set<Permission> {
  return BASE_PERMISSIONS_BY_ROLE[role];
}
