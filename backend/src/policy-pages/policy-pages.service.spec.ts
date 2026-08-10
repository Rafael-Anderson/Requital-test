import { NotFoundException } from '@nestjs/common';
import { PolicyPagesService } from './policy-pages.service';
import type { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';

function ctxFor(shopId: number): TenantContext {
  return { userId: 1, shopId, role: 'admin', outletId: null };
}

function createMockDb() {
  return {
    query: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affectedRows: 1 }),
    // upsert.util.ts calls this.db.pool.query(...) directly (bypassing the
    // DatabaseService wrapper).
    pool: { query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) },
  } as unknown as DatabaseService & {
    query: jest.Mock;
    execute: jest.Mock;
    pool: { query: jest.Mock };
  };
}

describe('PolicyPagesService.findAll', () => {
  it("returns only the requesting shop's rows, all 5 types with null content where unwritten", async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        type: 'TERMS',
        content: '<p>Terms</p>',
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    const service = new PolicyPagesService(db);

    const result = await service.findAll(ctxFor(10));

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE shopId = ?'),
      [10],
    );
    expect(result).toHaveLength(5);
    expect(result.find((r) => r.type === 'TERMS')?.content).toBe(
      '<p>Terms</p>',
    );
    expect(result.find((r) => r.type === 'PRIVACY')?.content).toBeNull();
  });
});

describe('PolicyPagesService.upsert', () => {
  it("saves content scoped to the requesting shop's id, never a client-supplied one", async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      { shopId: 10, type: 'PRIVACY', content: '<p>New privacy content</p>' },
    ]);
    const service = new PolicyPagesService(db);

    await service.upsert(ctxFor(10), 'PRIVACY', {
      content: '<p>New privacy content</p>',
    });

    expect(db.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE'),
      [10, 'PRIVACY', '<p>New privacy content</p>', expect.any(Date)],
    );
  });

  it("a shop can never write another shop's row — the DTO carries no shopId, ctx.shopId is the only source", async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([{}]);
    const service = new PolicyPagesService(db);

    await service.upsert(ctxFor(999), 'TERMS', { content: 'hijack attempt' });

    expect(db.pool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([999, 'TERMS']),
    );
  });
});

describe('PolicyPagesService.findPublic', () => {
  it('returns the row when one exists for that shop/type', async () => {
    const db = createMockDb();
    const row = { shopId: 10, type: 'REFUND', content: '<p>Refunds</p>' };
    db.query.mockResolvedValue([row]);
    const service = new PolicyPagesService(db);

    await expect(service.findPublic(10, 'REFUND')).resolves.toEqual(row);
  });

  it('404s rather than returning blank content when nothing has been published', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([]);
    const service = new PolicyPagesService(db);

    await expect(service.findPublic(10, 'SHIPPING')).rejects.toThrow(
      NotFoundException,
    );
  });
});
