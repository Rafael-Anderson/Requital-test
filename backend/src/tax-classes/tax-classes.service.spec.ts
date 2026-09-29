import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TaxClassesService } from './tax-classes.service';
import type { DatabaseService } from '../database/database.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { TenantContext } from '../common/tenant-context';

const mockAuditLog = {
  logCtx: jest.fn().mockResolvedValue(undefined),
} as unknown as AuditLogService;

interface MockDb {
  query: jest.Mock;
  execute: jest.Mock;
  transaction: jest.Mock;
}

const STANDARD = {
  id: 1,
  shopId: 7,
  name: 'Standard',
  rate: '5.00',
  type: 'standard',
  isDefault: true,
};
const ZERO = {
  id: 2,
  shopId: 7,
  name: 'Zero rated',
  rate: '0.00',
  type: 'zero',
  isDefault: false,
};

function createMockDb(rows: unknown[] = [STANDARD]): DatabaseService & MockDb {
  const db: MockDb = {
    query: jest.fn().mockResolvedValue(rows),
    execute: jest.fn().mockResolvedValue({ insertId: 1 }),
    // Runs the callback against a connection whose query() records calls, so a
    // test can assert what actually ran inside the transaction.
    transaction: jest.fn(async (cb: (conn: unknown) => Promise<unknown>) => {
      const conn = {
        query: jest.fn().mockResolvedValue([{ insertId: 9 }]),
      };
      (db as unknown as { lastConn: unknown }).lastConn = conn;
      return cb(conn);
    }),
  };
  return db as unknown as DatabaseService & MockDb;
}

// jest.Mock's `calls` is `any[][]`, which makes every indexed read below an
// unsafe-member-access finding. One typed accessor instead of six suppressions.
function calls(mock: jest.Mock): unknown[][] {
  return mock.mock.calls as unknown[][];
}

function lastConn(db: DatabaseService & MockDb): jest.Mock {
  return (db as unknown as { lastConn: { query: jest.Mock } }).lastConn.query;
}

function connCalls(db: DatabaseService & MockDb): string[] {
  return calls(lastConn(db)).map((c) => String(c[0]));
}

const ctx: TenantContext = {
  userId: 1,
  shopId: 7,
  role: 'admin',
  outletId: null,
};

describe('TaxClassesService', () => {
  beforeEach(() => jest.clearAllMocks());

  // The invariant that matters most. zero/exempt/out_of_scope are 0% by
  // definition; a 'zero' class carrying 5% would charge VAT on something the
  // merchant declared zero-rated, which is the wrong-return bug this feature
  // exists to fix.
  it.each(['zero', 'exempt', 'out_of_scope'])(
    'create() rejects a non-zero rate on a %s class',
    async (type) => {
      const service = new TaxClassesService(createMockDb(), mockAuditLog);
      await expect(
        service.create(ctx, { name: 'Food', rate: 5, type }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('create() allows a non-zero rate on a standard class', async () => {
    const db = createMockDb();
    const service = new TaxClassesService(db, mockAuditLog);
    await service.create(ctx, { name: 'VAT 5%', rate: 5, type: 'standard' });
    expect(db.transaction).toHaveBeenCalled();
  });

  it('create() forces the FIRST class of a shop to be the default', async () => {
    // No rows yet -> countForShop() sees 0.
    const db = createMockDb([{ n: 0 }]);
    const service = new TaxClassesService(db, mockAuditLog);
    await service.create(ctx, { name: 'Standard', rate: 5, type: 'standard' });

    const insertCall = calls(lastConn(db)).find((c) =>
      String(c[0]).includes('INSERT INTO taxclass'),
    );
    expect(insertCall).toBeDefined();
    // isDefault is the 5th bound parameter.
    expect((insertCall![1] as unknown[])[4]).toBe(true);
  });

  it('create() clears every other default when this one becomes default', async () => {
    const db = createMockDb([{ n: 2 }]);
    const service = new TaxClassesService(db, mockAuditLog);
    await service.create(ctx, {
      name: 'New standard',
      rate: 5,
      type: 'standard',
      isDefault: true,
    });
    const sqls = connCalls(db);
    expect(sqls.some((s) => s.includes('SET isDefault = FALSE'))).toBe(true);
  });

  it('create() does NOT clear defaults when the new class is not default', async () => {
    const db = createMockDb([{ n: 2 }]);
    const service = new TaxClassesService(db, mockAuditLog);
    await service.create(ctx, { name: 'Exempt', rate: 0, type: 'exempt' });
    expect(connCalls(db).some((s) => s.includes('SET isDefault = FALSE'))).toBe(
      false,
    );
  });

  it('create() maps a duplicate name to ConflictException', async () => {
    const db = createMockDb([{ n: 1 }]);
    db.transaction.mockRejectedValueOnce(
      Object.assign(new Error('ER_DUP_ENTRY'), { errno: 1062 }),
    );
    const service = new TaxClassesService(db, mockAuditLog);
    await expect(
      service.create(ctx, { name: 'Standard', rate: 5, type: 'standard' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Validates the RESULTING pair, not just what the request mentioned.
  it('update() rejects switching a 5% class to zero without also zeroing the rate', async () => {
    const service = new TaxClassesService(
      createMockDb([STANDARD]),
      mockAuditLog,
    );
    await expect(
      service.update(ctx, 1, { type: 'zero' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update() allows switching to zero when the rate is zeroed in the same call', async () => {
    const db = createMockDb([STANDARD]);
    const service = new TaxClassesService(db, mockAuditLog);
    await service.update(ctx, 1, { type: 'zero', rate: 0 });
    expect(db.transaction).toHaveBeenCalled();
  });

  it('update() refuses to clear the default rather than leaving a shop with none', async () => {
    const service = new TaxClassesService(
      createMockDb([STANDARD]),
      mockAuditLog,
    );
    await expect(
      service.update(ctx, 1, { isDefault: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update() scopes its read to ctx.shopId and 404s an unknown id', async () => {
    const db = createMockDb([]);
    const service = new TaxClassesService(db, mockAuditLog);
    await expect(service.update(ctx, 99, { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls(db.query)[0][1]).toEqual([99, 7]);
  });

  // The default is what an unassigned product resolves through, so deleting it
  // would leave the shop with undefined behaviour once B2 computes per line.
  it('remove() refuses to delete the default class', async () => {
    const service = new TaxClassesService(
      createMockDb([STANDARD]),
      mockAuditLog,
    );
    await expect(service.remove(ctx, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('remove() unassigns affected products in the same transaction and reports how many', async () => {
    const db = createMockDb();
    // findOne -> non-default class; countProductsUsing -> 3
    db.query.mockResolvedValueOnce([ZERO]).mockResolvedValueOnce([{ n: 3 }]);
    const service = new TaxClassesService(db, mockAuditLog);

    const result = await service.remove(ctx, 2);

    expect(result).toEqual({ id: 2, deleted: true, productsUnassigned: 3 });
    const sqls = connCalls(db);
    expect(sqls.some((s) => s.includes('SET taxClassId = NULL'))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM taxclass'))).toBe(true);
  });

  it('assertOwned() rejects a class belonging to another shop', async () => {
    const db = createMockDb([]);
    const service = new TaxClassesService(db, mockAuditLog);
    await expect(service.assertOwned(7, 42)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls(db.query)[0][1]).toEqual([42, 7]);
  });

  it('findAll() is shop-scoped and puts the default first', async () => {
    const db = createMockDb([STANDARD, ZERO]);
    const service = new TaxClassesService(db, mockAuditLog);
    await service.findAll(ctx);
    const [sql, params] = calls(db.query)[0] as [string, unknown[]];
    expect(sql).toContain('WHERE shopId = ?');
    expect(sql).toContain('ORDER BY isDefault DESC');
    expect(params).toEqual([7]);
  });
});
