import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorefrontSearchService } from './storefront-search.service';
import type { PrismaService } from '../prisma/prisma.service';

function fakeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Rose Bouquet',
    slug: 'rose-bouquet',
    thumbnail: 't.jpg',
    price: new Prisma.Decimal(50),
    sku: 'ROSE-1',
    description: 'A lovely bouquet',
    shortSummary: null,
    producttag: [],
    collectionproduct: [],
    ...overrides,
  };
}

function createMockPrisma(products: ReturnType<typeof fakeProduct>[]) {
  return {
    shop: {
      findUnique: jest.fn().mockResolvedValue({ id: 10, published: true }),
    },
    product: {
      findMany: jest.fn().mockResolvedValue(products),
    },
  } as unknown as PrismaService;
}

describe('StorefrontSearchService.search', () => {
  it('returns an empty result for an empty query without hitting the database', async () => {
    const prisma = createMockPrisma([]);
    const service = new StorefrontSearchService(prisma);

    const result = await service.search('test-shop', '   ');

    expect(result).toEqual({ results: [], nextCursor: null, matchType: 'none', suggestion: null });
    expect((prisma as any).shop.findUnique).not.toHaveBeenCalled();
  });

  it('returns exact matches when the query substring-matches a product name', async () => {
    const prisma = createMockPrisma([
      fakeProduct({ id: 1, name: 'Rose Bouquet' }),
      fakeProduct({ id: 2, name: 'Tulip Bouquet', sku: 'TULIP-1', description: 'Bright and cheerful' }),
    ]);
    const service = new StorefrontSearchService(prisma);

    const result = await service.search('test-shop', 'rose');

    expect(result.matchType).toBe('exact');
    expect(result.results.map((r) => r.id)).toEqual([1]);
    expect(result.suggestion).toBeNull();
  });

  it('falls back to fuzzy matching a single-character typo when exact match finds nothing', async () => {
    const prisma = createMockPrisma([fakeProduct({ id: 1, name: 'Rose Bouquet', sku: 'ROSE-1', description: '' })]);
    const service = new StorefrontSearchService(prisma);

    const result = await service.search('test-shop', 'roes');

    expect(result.matchType).toBe('fuzzy');
    expect(result.results.map((r) => r.id)).toEqual([1]);
  });

  it('fuzzy-matches a typo in a longer word ("choclate" -> "chocolate")', async () => {
    const prisma = createMockPrisma([
      fakeProduct({ id: 1, name: 'Chocolate Box', sku: 'CHOC-1', description: '' }),
    ]);
    const service = new StorefrontSearchService(prisma);

    const result = await service.search('test-shop', 'choclate');

    expect(result.matchType).toBe('fuzzy');
    expect(result.results.map((r) => r.id)).toEqual([1]);
  });

  it('returns matchType "none" when even fuzzy matching finds nothing', async () => {
    const prisma = createMockPrisma([fakeProduct({ id: 1, name: 'Rose Bouquet', sku: 'ROSE-1', description: '' })]);
    const service = new StorefrontSearchService(prisma);

    const result = await service.search('test-shop', 'zzzzzzzzzzzzzzz');

    expect(result.matchType).toBe('none');
    expect(result.results).toEqual([]);
  });

  it('never returns another shop\'s products — query is always scoped to the resolved shopId', async () => {
    const prisma = createMockPrisma([fakeProduct({ id: 1, name: 'Rose Bouquet' })]);
    const service = new StorefrontSearchService(prisma);

    await service.search('test-shop', 'rose');

    expect((prisma as any).product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ shopId: 10 }) }),
    );
  });

  it('throws NotFoundException for a shop that does not exist or is unpublished', async () => {
    const prisma = createMockPrisma([]);
    (prisma as any).shop.findUnique = jest.fn().mockResolvedValue(null);
    const service = new StorefrontSearchService(prisma);

    await expect(service.search('nonexistent', 'rose')).rejects.toThrow(NotFoundException);
  });

  it('caches identical (shop, query) results — a second call does not re-query the database', async () => {
    const prisma = createMockPrisma([fakeProduct({ id: 1, name: 'Rose Bouquet' })]);
    const service = new StorefrontSearchService(prisma);

    await service.search('test-shop', 'rose');
    await service.search('test-shop', 'rose');

    expect((prisma as any).product.findMany).toHaveBeenCalledTimes(1);
  });

  it('paginates results with a limit of 20 and a cursor for the next page', async () => {
    const products = Array.from({ length: 25 }, (_, i) => fakeProduct({ id: i + 1, name: 'Rose Bouquet' }));
    const prisma = createMockPrisma(products);
    const service = new StorefrontSearchService(prisma);

    const first = await service.search('test-shop', 'rose');
    expect(first.results).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.search('test-shop', 'rose', first.nextCursor!);
    expect(second.results).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
  });
});
