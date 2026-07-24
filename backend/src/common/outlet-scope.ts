import type { TenantContext } from './tenant-context';

// The branch-user outlet-override rule, shared by every outlet-scoped
// module (orders, dashboard, products/stock): a branch user is always
// forced onto their own outlet regardless of what a request asks for — an
// admin gets every outlet by default (`undefined` = no filter), or one
// specific outlet if they ask for it via `requestedOutletId`.
export function resolveOutletFilter(
  ctx: TenantContext,
  requestedOutletId?: number,
): number | undefined {
  if (ctx.role === 'branch') return ctx.outletId!;
  return requestedOutletId;
}
