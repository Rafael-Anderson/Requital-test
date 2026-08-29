import { ConflictException, NotFoundException } from '@nestjs/common';
import { BrandsService } from './brands.service';
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

function createMockDb(): DatabaseService & MockDb {
  const db: MockDb = {
    query: jest
      .fn()
      .mockResolvedValue([{ id: 1, name: 'Acme', logoUrl: null }]),
    execute: jest.fn().mockResolvedValue({ insertId: 1 }),
    transaction: jest.fn(),
  };
  return db as unknown as DatabaseService & MockDb;
}

const ctx: TenantContext = {
  userId: 1,
  shopId: 7,
  role: 'admin',
  outletId: null,
};

describe('BrandsService', () => {
  it('create() maps a duplicate-name key error to ConflictException', async () => {
    const db = createMockDb();
    db.execute.mockRejectedValueOnce(
      Object.assign(new Error('ER_DUP_ENTRY'), { errno: 1062 }),
    );
    const service = new BrandsService(db, mockAuditLog);

    await expect(service.create(ctx, { name: 'Acme' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('create() scopes the insert to ctx.shopId', async () => {
    const db = createMockDb();
    const service = new BrandsService(db, mockAuditLog);

    await service.create(ctx, { name: 'Acme', logoUrl: 'x.png' });

    const call = db.execute.mock.calls[0] as [string, unknown[]];
    expect(call[0]).toMatch(/INSERT INTO brand/);
    expect(call[1].slice(0, 3)).toEqual([7, 'Acme', 'x.png']);
  });

  it('update() rejects a brand that does not belong to the shop (findOne first)', async () => {
    const db = createMockDb();
    db.query.mockResolvedValueOnce([]); // findOne -> not found
    const service = new BrandsService(db, mockAuditLog);

    await expect(
      service.update(ctx, 99, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('remove() nulls product.brandId then deletes, both scoped by shopId', async () => {
    const db = createMockDb();
    const innerQuery = jest.fn().mockResolvedValue([[]]);
    db.transaction.mockImplementation(
      (cb: (conn: { query: jest.Mock }) => Promise<unknown>) =>
        cb({ query: innerQuery }),
    );
    const service = new BrandsService(db, mockAuditLog);

    await service.remove(ctx, 3);

    expect(innerQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/UPDATE product SET brandId = NULL/),
      [3, 7],
    );
    expect(innerQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/DELETE FROM brand/),
      [3, 7],
    );
  });
});
