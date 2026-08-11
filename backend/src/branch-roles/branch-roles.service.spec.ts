import { BranchRolesService } from './branch-roles.service';
import { basePermissionsFor } from '../common/permissions';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';

// This is the actual security guarantee behind the whole branch-roles
// feature — restrict-only is enforced by the intersection in
// resolveEffectivePermissions, not by anything in the admin UI or the
// shape of the useroutletrole table. These tests exist specifically to
// prove that guarantee directly, rather than relying only on e2e coverage
// that could pass for the wrong reason (e.g. a role that happens to be
// admin-only reachable everywhere it's tested).

// resolveEffectivePermissions joins useroutletrole -> branchrole and
// selects just br.permissions — mockResolvedValue([{ permissions }]) for
// an override, or ([]) for "no override row".
function createMockDb() {
  return { query: jest.fn() } as unknown as DatabaseService & {
    query: jest.Mock;
  };
}

function ctxFor(
  role: TenantContext['role'],
  outletId: number | null = null,
): TenantContext {
  return { userId: 1, shopId: 1, role, outletId };
}

describe('basePermissionsFor', () => {
  it('admin has every permission in the fixed vocabulary', () => {
    const perms = basePermissionsFor('admin');
    expect(perms.has('orders.manage')).toBe(true);
    expect(perms.has('products.manage_stock')).toBe(true);
    expect(perms.has('payments.generate_link')).toBe(true);
  });

  it("viewer lacks every mutating permission (matches 'no mutations anywhere')", () => {
    const perms = basePermissionsFor('viewer');
    expect(perms.has('orders.manage')).toBe(false);
    expect(perms.has('products.manage_stock')).toBe(false);
    expect(perms.has('payments.generate_link')).toBe(false);
    expect(perms.has('orders.view')).toBe(true);
  });

  it("order_manager lacks catalog/product permissions (matches 'no pricing, catalog, or settings access')", () => {
    const perms = basePermissionsFor('order_manager');
    expect(perms.has('products.view')).toBe(false);
    expect(perms.has('products.manage_stock')).toBe(false);
    expect(perms.has('ingredients.view')).toBe(false);
    expect(perms.has('orders.manage')).toBe(true);
  });

  it('branch has full reach, matching everything it can access today', () => {
    const perms = basePermissionsFor('branch');
    expect(perms.has('orders.manage')).toBe(true);
    expect(perms.has('products.manage_stock')).toBe(true);
    expect(perms.has('dashboard.view')).toBe(true);
  });
});

describe('BranchRolesService.resolveEffectivePermissions', () => {
  it("returns null (no override) when no useroutletrole row exists — callers must fall through to today's logic unchanged", async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([]);
    const service = new BranchRolesService(db);

    const result = await service.resolveEffectivePermissions(
      ctxFor('admin'),
      5,
    );

    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [1, 5]);
  });

  it('a strict-subset override on an admin correctly restricts them to exactly that subset', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      { permissions: ['orders.view', 'dashboard.view'] },
    ]);
    const service = new BranchRolesService(db);

    const result = await service.resolveEffectivePermissions(
      ctxFor('admin'),
      5,
    );

    expect(result).toEqual(new Set(['orders.view', 'dashboard.view']));
    expect(result?.has('products.manage_stock')).toBe(false);
  });

  // The critical test: a shop-wide 'viewer' (base permissions exclude every
  // mutating permission) is assigned a branchrole that — whether through a
  // careless admin, a UI bug, or a direct spoofed API call — grants
  // 'orders.manage'. The intersection must strip it: the effective set can
  // never exceed the user's shop-wide ceiling, no matter what the
  // assignment itself says.
  it('an attempted upgrade beyond the base role is silently stripped by the intersection, never granted', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        permissions: ['orders.view', 'orders.manage', 'payments.generate_link'],
      },
    ]);
    const service = new BranchRolesService(db);

    const result = await service.resolveEffectivePermissions(
      ctxFor('viewer'),
      5,
    );

    // viewer's base set has orders.view but not orders.manage or
    // payments.generate_link — the branchrole nominally grants all three,
    // but only the one already within viewer's ceiling survives.
    expect(result).toEqual(new Set(['orders.view']));
    expect(result?.has('orders.manage')).toBe(false);
    expect(result?.has('payments.generate_link')).toBe(false);
  });

  it('an order_manager base role strips products/ingredients permissions from an over-generous branchrole', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        permissions: [
          'products.view',
          'products.manage_stock',
          'orders.manage',
        ],
      },
    ]);
    const service = new BranchRolesService(db);

    const result = await service.resolveEffectivePermissions(
      ctxFor('order_manager'),
      5,
    );

    expect(result).toEqual(new Set(['orders.manage']));
  });

  it('gracefully ignores garbage/unknown values in a corrupted permissions JSON column', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        permissions: ['orders.view', 'not.a.real.permission', 123, null],
      },
    ]);
    const service = new BranchRolesService(db);

    const result = await service.resolveEffectivePermissions(
      ctxFor('admin'),
      5,
    );

    expect(result).toEqual(new Set(['orders.view']));
  });
});

describe('BranchRolesService.assertPermission', () => {
  it('passes silently when there is no override at all', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([]);
    const service = new BranchRolesService(db);

    await expect(
      service.assertPermission(ctxFor('viewer'), 5, 'orders.manage'),
    ).resolves.toBeUndefined();
  });

  it('passes silently when the effective (post-intersection) set includes the required permission', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{ permissions: ['orders.view'] }]);
    const service = new BranchRolesService(db);

    await expect(
      service.assertPermission(ctxFor('admin'), 5, 'orders.view'),
    ).resolves.toBeUndefined();
  });

  it('throws ForbiddenException when the effective set exists but lacks the required permission', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{ permissions: ['orders.view'] }]);
    const service = new BranchRolesService(db);

    await expect(
      service.assertPermission(ctxFor('admin'), 5, 'orders.manage'),
    ).rejects.toThrow("Missing permission 'orders.manage' at this outlet");
  });

  it('throws even when the branchrole nominally grants the permission but the base role does not (upgrade attempt)', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{ permissions: ['orders.manage'] }]);
    const service = new BranchRolesService(db);

    await expect(
      service.assertPermission(ctxFor('viewer'), 5, 'orders.manage'),
    ).rejects.toThrow("Missing permission 'orders.manage' at this outlet");
  });
});
