import { NotFoundException } from '@nestjs/common';
import { StorefrontSearchService } from './storefront-search.service';
import type { DatabaseService } from '../database/database.service';

function fakeProductRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Rose Bouquet',
    slug: 'rose-bouquet',
    thumbnail: 't.jpg',
    price: '50.00',
    sku: 'ROSE-1',
    description: 'A lovely bouquet',
    shortSummary: null,
    tags: null,
    templates: null,
    ...overrides,
  };
}

function createMockDb(products: ReturnType<typeof fakeProductRow>[]) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM shop')) return [{ id: 10, published: true }];
    if (sql.includes('FROM product')) return products;
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query } as unknown as DatabaseService & { query: jest.Mock };
}

describe('StorefrontSearchService.search', () => {
  it('returns an empty result for an empty query without hitting the database', async () => {
    const db = createMockDb([]);
    const service = new StorefrontSearchService(db);

    const result = await service.search('test-shop', '   ');

    expect(result).toEqual({
      results: [],
      nextCursor: null,
      matchType: 'none',
      suggestion: null,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns exact matches when the query substring-matches a product name', async () => {
    const db = createMockDb([
      fakeProductRow({ id: 1, name: 'Rose Bouquet' }),
      fakeProductRow({
        id: 2,
        name: 'Tulip Bouquet',
        sku: 'TULIP-1',
        description: 'Bright and cheerful',
      }),
    ]);
    const service = new StorefrontSearchService(db);

    const result = await service.search('test-shop', 'rose');

    expect(result.matchType).toBe('exact');
    expect(result.results.map((r) => r.id)).toEqual([1]);
    expect(result.suggestion).toBeNull();
  });

  it('falls back to fuzzy matching a single-character typo when exact match finds nothing', async () => {
    const db = createMockDb([
      fakeProductRow({
        id: 1,
        name: 'Rose Bouquet',
        sku: 'ROSE-1',
        description: '',
      }),
    ]);
    const service = new StorefrontSearchService(db);

    const result = await service.search('test-shop', 'roes');

    expect(result.matchType).toBe('fuzzy');
    expect(result.results.map((r) => r.id)).toEqual([1]);
  });

  it('fuzzy-matches a typo in a longer word ("choclate" -> "chocolate")', async () => {
    const db = createMockDb([
      fakeProductRow({
        id: 1,
        name: 'Chocolate Box',
        sku: 'CHOC-1',
        description: '',
      }),
    ]);
    const service = new StorefrontSearchService(db);

    const result = await service.search('test-shop', 'choclate');

    expect(result.matchType).toBe('fuzzy');
    expect(result.results.map((r) => r.id)).toEqual([1]);
  });

  it('returns matchType "none" when even fuzzy matching finds nothing', async () => {
    const db = createMockDb([
      fakeProductRow({
        id: 1,
        name: 'Rose Bouquet',
        sku: 'ROSE-1',
        description: '',
      }),
    ]);
    const service = new StorefrontSearchService(db);

    const result = await service.search('test-shop', 'zzzzzzzzzzzzzzz');

    expect(result.matchType).toBe('none');
    expect(result.results).toEqual([]);
  });

  it("never returns another shop's products — query is always scoped to the resolved shopId", async () => {
    const db = createMockDb([fakeProductRow({ id: 1, name: 'Rose Bouquet' })]);
    const service = new StorefrontSearchService(db);

    await service.search('test-shop', 'rose');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM product'),
      expect.arrayContaining([10]),
    );
  });

  it('throws NotFoundException for a shop that does not exist or is unpublished', async () => {
    const db = createMockDb([]);
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM shop')) return [];
      return [];
    });
    const service = new StorefrontSearchService(db);

    await expect(service.search('nonexistent', 'rose')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('caches identical (shop, query) results — a second call does not re-query the database', async () => {
    const db = createMockDb([fakeProductRow({ id: 1, name: 'Rose Bouquet' })]);
    const service = new StorefrontSearchService(db);

    await service.search('test-shop', 'rose');
    await service.search('test-shop', 'rose');

    const productQueryCalls = db.query.mock.calls.filter(([sql]: [string]) =>
      sql.includes('FROM product'),
    );
    expect(productQueryCalls).toHaveLength(1);
  });

  it('paginates results with a limit of 20 and a cursor for the next page', async () => {
    const products = Array.from({ length: 25 }, (_, i) =>
      fakeProductRow({ id: i + 1, name: 'Rose Bouquet' }),
    );
    const db = createMockDb(products);
    const service = new StorefrontSearchService(db);

    const first = await service.search('test-shop', 'rose');
    expect(first.results).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.search('test-shop', 'rose', first.nextCursor!);
    expect(second.results).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
  });
});
