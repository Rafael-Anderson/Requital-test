import { BadRequestException } from '@nestjs/common';
import { DiscountsService } from './discounts.service';
import type { DatabaseService } from '../database/database.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { TenantContext } from '../common/tenant-context';

interface FakeDiscountRow {
  id: number;
  shopId: number;
  code: string | null;
  discountType: string;
  type: string;
  value: string | null;
  minPurchaseAmount: string | null;
  appliesTo: string;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  timesUsed: number;
}

const adminCtx: TenantContext = { userId: 1, shopId: 1, role: 'admin', outletId: null };
const mockAuditLog = { logCtx: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;

// One shared in-memory store, driven by SQL-substring matching — the same
// technique invoices.service.spec.ts uses, since DiscountsService.create/
// update genuinely goes through a real transaction + batch-load round trip
// (loadDiscountsWithRelations), not a single INSERT.
function createMockDb() {
  const discounts: FakeDiscountRow[] = [];
  const productLinks: { discountId: number; productId: number }[] = [];
  const collectionLinks: { discountId: number; collectionId: number }[] = [];
  let nextId = 1;

  interface MockConn {
    query: jest.Mock;
  }
  const conn: MockConn = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO discount ')) {
        const [
          shopId, code, discountType, type, value, minPurchaseAmount,
          appliesTo, usageLimit, usageLimitPerCustomer, startsAt, endsAt, active,
        ] = params as [number, string | null, string, string, number | null, number | null, string, number | null, number | null, Date | null, Date | null, boolean];
        const row: FakeDiscountRow = {
          id: nextId++, shopId, code, discountType, type,
          value: value === null ? null : String(value),
          minPurchaseAmount: minPurchaseAmount === null ? null : String(minPurchaseAmount),
          appliesTo, usageLimit, usageLimitPerCustomer, startsAt, endsAt,
          active, timesUsed: 0,
        };
        discounts.push(row);
        return Promise.resolve([{ insertId: row.id }]);
      }
      if (sql.includes('INSERT INTO discountproduct')) {
        const flat = params as number[];
        for (let i = 0; i < flat.length; i += 2) {
          productLinks.push({ discountId: flat[i], productId: flat[i + 1] });
        }
        return Promise.resolve([{}]);
      }
      if (sql.includes('INSERT INTO discountcollection')) {
        const flat = params as number[];
        for (let i = 0; i < flat.length; i += 2) {
          collectionLinks.push({ discountId: flat[i], collectionId: flat[i + 1] });
        }
        return Promise.resolve([{}]);
      }
      if (sql.includes('DELETE FROM discountproduct')) {
        const id = params[0] as number;
        for (let i = productLinks.length - 1; i >= 0; i--) {
          if (productLinks[i].discountId === id) productLinks.splice(i, 1);
        }
        return Promise.resolve([{}]);
      }
      if (sql.includes('DELETE FROM discountcollection')) {
        const id = params[0] as number;
        for (let i = collectionLinks.length - 1; i >= 0; i--) {
          if (collectionLinks[i].discountId === id) collectionLinks.splice(i, 1);
        }
        return Promise.resolve([{}]);
      }
      if (sql.startsWith('UPDATE discount SET')) {
        const id = params[params.length - 1] as number;
        const row = discounts.find((d) => d.id === id)!;
        // Mirrors buildSetClause's `col = ?` shape closely enough to apply
        // each bound param back onto the matching column by name.
        const cols = sql
          .slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'))
          .split(',')
          .map((c) => c.trim().replace(/`/g, '').replace(/\s*=\s*\?$/, ''));
        cols.forEach((col, i) => {
          (row as unknown as Record<string, unknown>)[col] = params[i];
        });
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    }),
  };

  const db = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes('COUNT(*) AS c FROM product')) {
        const uniqueIds = params.slice(0, -1) as number[];
        return Promise.resolve([{ c: uniqueIds.length }]);
      }
      if (sql.includes('COUNT(*) AS c FROM collection')) {
        const uniqueIds = params.slice(0, -1) as number[];
        return Promise.resolve([{ c: uniqueIds.length }]);
      }
      if (sql.includes('FROM discount WHERE id = ? AND shopId = ?')) {
        const [id, shopId] = params as [number, number];
        const row = discounts.find((d) => d.id === id && d.shopId === shopId);
        return Promise.resolve(row ? [row] : []);
      }
      if (sql.includes('SELECT * FROM discount WHERE id IN')) {
        const ids = params as number[];
        return Promise.resolve(discounts.filter((d) => ids.includes(d.id)));
      }
      if (sql.includes('FROM discountproduct dp JOIN product p')) {
        const ids = params as number[];
        return Promise.resolve(
          productLinks
            .filter((l) => ids.includes(l.discountId))
            .map((l) => ({ discountId: l.discountId, productId: l.productId, productName: `Product ${l.productId}` })),
        );
      }
      if (sql.includes('FROM discountcollection dc JOIN collection c')) {
        const ids = params as number[];
        return Promise.resolve(
          collectionLinks
            .filter((l) => ids.includes(l.discountId))
            .map((l) => ({ discountId: l.discountId, collectionId: l.collectionId, collectionName: `Collection ${l.collectionId}` })),
        );
      }
      if (sql.includes("discountType = 'auto' AND active = 1")) {
        const [shopId] = params as [number, Date, Date];
        return Promise.resolve(
          discounts
            .filter((d) => d.shopId === shopId && d.discountType === 'auto' && d.active)
            .map((d) => ({ id: d.id })),
        );
      }
      return Promise.resolve([]);
    }),
    transaction: jest.fn((cb: (conn: MockConn) => Promise<unknown>) => cb(conn)),
  } as unknown as DatabaseService;

  return { db, discounts, productLinks, collectionLinks };
}

describe('DiscountsService — auto-apply discounts', () => {
  it('rejects an auto discount with a code set', async () => {
    const { db } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);

    await expect(
      service.create(adminCtx, {
        code: 'SUMMER10',
        discountType: 'auto',
        type: 'PERCENTAGE',
        value: 10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [1],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a code-based discount with no code', async () => {
    const { db } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);

    await expect(
      service.create(adminCtx, { type: 'PERCENTAGE', value: 10 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an auto discount scoped to ALL_PRODUCTS (must target specific products/collections)', async () => {
    const { db } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);

    await expect(
      service.create(adminCtx, { discountType: 'auto', type: 'PERCENTAGE', value: 10 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates an auto discount scoped to specific products with no code, stored as code = null', async () => {
    const { db, discounts } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);

    const result = await service.create(adminCtx, {
      discountType: 'auto',
      type: 'PERCENTAGE',
      value: 15,
      appliesTo: 'SPECIFIC_PRODUCTS',
      productIds: [1, 2],
    });

    expect(result.code).toBeNull();
    expect(result.discountType).toBe('auto');
    expect(discounts[0].code).toBeNull();
  });

  it('switching an existing code discount to auto clears its code even if this request never sent one', async () => {
    const { db, discounts } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);
    const created = await service.create(adminCtx, {
      code: 'WELCOME10',
      type: 'PERCENTAGE',
      value: 10,
      appliesTo: 'SPECIFIC_COLLECTIONS',
      collectionIds: [5],
    });
    expect(created.code).toBe('WELCOME10');

    await service.update(adminCtx, created.id, { discountType: 'auto' });

    expect(discounts.find((d) => d.id === created.id)!.code).toBeNull();
  });

  it('rejects switching to auto while still scoped to ALL_PRODUCTS', async () => {
    const { db } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);
    const created = await service.create(adminCtx, { code: 'WELCOME10', type: 'PERCENTAGE', value: 10 });

    await expect(service.update(adminCtx, created.id, { discountType: 'auto' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('listActiveAutoDiscounts returns only active auto discounts, with resolved product/collection ids', async () => {
    const { db } = createMockDb();
    const service = new DiscountsService(db, mockAuditLog);
    await service.create(adminCtx, {
      discountType: 'auto',
      type: 'FIXED_AMOUNT',
      value: 5,
      appliesTo: 'SPECIFIC_PRODUCTS',
      productIds: [7, 8],
    });
    await service.create(adminCtx, { code: 'CODE1', type: 'PERCENTAGE', value: 10 });

    const result = await service.listActiveAutoDiscounts(adminCtx.shopId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'FIXED_AMOUNT', value: '5', appliesTo: 'SPECIFIC_PRODUCTS' });
    expect(result[0].productIds.sort()).toEqual([7, 8]);
  });
});
