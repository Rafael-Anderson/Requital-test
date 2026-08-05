import { NotFoundException } from '@nestjs/common';
import { PolicyPagesService } from './policy-pages.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';

function ctxFor(shopId: number): TenantContext {
  return { userId: 1, shopId, role: 'admin', outletId: null };
}

function createMockPrisma() {
  return {
    policypage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  } as unknown as PrismaService & {
    policypage: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };
}

describe('PolicyPagesService.findAll', () => {
  it("returns only the requesting shop's rows, all 5 types with null content where unwritten", async () => {
    const prisma = createMockPrisma();
    prisma.policypage.findMany.mockResolvedValue([
      {
        type: 'TERMS',
        content: '<p>Terms</p>',
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    const service = new PolicyPagesService(prisma);

    const result = await service.findAll(ctxFor(10));

    expect(prisma.policypage.findMany).toHaveBeenCalledWith({
      where: { shopId: 10 },
    });
    expect(result).toHaveLength(5);
    expect(result.find((r) => r.type === 'TERMS')?.content).toBe(
      '<p>Terms</p>',
    );
    expect(result.find((r) => r.type === 'PRIVACY')?.content).toBeNull();
  });
});

describe('PolicyPagesService.upsert', () => {
  it("saves content scoped to the requesting shop's id, never a client-supplied one", async () => {
    const prisma = createMockPrisma();
    prisma.policypage.upsert.mockResolvedValue({
      shopId: 10,
      type: 'PRIVACY',
      content: '<p>New privacy content</p>',
    });
    const service = new PolicyPagesService(prisma);

    await service.upsert(ctxFor(10), 'PRIVACY', {
      content: '<p>New privacy content</p>',
    });

    expect(prisma.policypage.upsert).toHaveBeenCalledWith({
      where: { shopId_type: { shopId: 10, type: 'PRIVACY' } },
      create: {
        shopId: 10,
        type: 'PRIVACY',
        content: '<p>New privacy content</p>',
      },
      update: { content: '<p>New privacy content</p>' },
    });
  });

  it("a shop can never write another shop's row — the DTO carries no shopId, ctx.shopId is the only source", async () => {
    const prisma = createMockPrisma();
    prisma.policypage.upsert.mockResolvedValue({});
    const service = new PolicyPagesService(prisma);

    await service.upsert(ctxFor(999), 'TERMS', { content: 'hijack attempt' });

    expect(prisma.policypage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopId_type: { shopId: 999, type: 'TERMS' } },
        create: expect.objectContaining({ shopId: 999 }),
      }),
    );
  });
});

describe('PolicyPagesService.findPublic', () => {
  it('returns the row when one exists for that shop/type', async () => {
    const prisma = createMockPrisma();
    const row = { shopId: 10, type: 'REFUND', content: '<p>Refunds</p>' };
    prisma.policypage.findUnique.mockResolvedValue(row);
    const service = new PolicyPagesService(prisma);

    await expect(service.findPublic(10, 'REFUND')).resolves.toEqual(row);
  });

  it('404s rather than returning blank content when nothing has been published', async () => {
    const prisma = createMockPrisma();
    prisma.policypage.findUnique.mockResolvedValue(null);
    const service = new PolicyPagesService(prisma);

    await expect(service.findPublic(10, 'SHIPPING')).rejects.toThrow(
      NotFoundException,
    );
  });
});
