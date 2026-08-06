import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotifySubscriptionsService } from './notify-subscriptions.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JobsService } from '../jobs/jobs.service';

beforeEach(() => {
  jest.clearAllMocks();
});

function createMockJobsService() {
  return {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as JobsService & { enqueue: jest.Mock };
}

function createMockPrisma() {
  return {
    product: { findUnique: jest.fn() },
    productvariant: { findFirst: jest.fn() },
    notifysubscription: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  } as unknown as PrismaService & {
    product: { findUnique: jest.Mock };
    productvariant: { findFirst: jest.Mock };
    notifysubscription: {
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
}

describe('NotifySubscriptionsService.subscribe', () => {
  it('creates a new subscription', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue({ id: 1, shopId: 10 });
    prisma.notifysubscription.findFirst.mockResolvedValue(null);
    prisma.notifysubscription.count.mockResolvedValue(0);
    prisma.notifysubscription.create.mockResolvedValue({
      id: 1,
      shopId: 10,
      productId: 1,
      variantId: null,
      email: 'a@b.com',
    });
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    const result = await service.subscribe({ productId: 1, email: 'a@b.com' });

    expect(result.alreadySubscribed).toBe(false);
    expect(prisma.notifysubscription.create).toHaveBeenCalledWith({
      data: { shopId: 10, productId: 1, variantId: null, email: 'a@b.com' },
    });
  });

  it('is idempotent — returns the existing row instead of erroring on a duplicate', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue({ id: 1, shopId: 10 });
    const existing = {
      id: 5,
      shopId: 10,
      productId: 1,
      variantId: null,
      email: 'a@b.com',
    };
    prisma.notifysubscription.findFirst.mockResolvedValue(existing);

    const service = new NotifySubscriptionsService(prisma, createMockJobsService());
    const result = await service.subscribe({ productId: 1, email: 'a@b.com' });

    expect(result.alreadySubscribed).toBe(true);
    expect(result.subscription).toEqual(existing);
    expect(prisma.notifysubscription.create).not.toHaveBeenCalled();
  });

  it('rejects a productId that does not exist (also covers cross-shop spoofing — shopId is always derived server-side from the product, never accepted from the client)', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue(null);
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    await expect(
      service.subscribe({ productId: 999, email: 'a@b.com' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a variantId that does not belong to the product', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue({ id: 1, shopId: 10 });
    prisma.productvariant.findFirst.mockResolvedValue(null);
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    await expect(
      service.subscribe({ productId: 1, variantId: 99, email: 'a@b.com' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks a 4th new subscription from the same email within the hour', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue({ id: 2, shopId: 10 });
    prisma.notifysubscription.findFirst.mockResolvedValue(null);
    prisma.notifysubscription.count.mockResolvedValue(3);
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    await expect(
      service.subscribe({ productId: 2, email: 'a@b.com' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.notifysubscription.create).not.toHaveBeenCalled();
  });

  it('does not count an idempotent duplicate against the rate limit', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue({ id: 2, shopId: 10 });
    prisma.notifysubscription.findFirst.mockResolvedValue({
      id: 1,
      shopId: 10,
      productId: 2,
      variantId: null,
      email: 'a@b.com',
    });
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    await service.subscribe({ productId: 2, email: 'a@b.com' });

    expect(prisma.notifysubscription.count).not.toHaveBeenCalled();
  });
});

describe('NotifySubscriptionsService.unsubscribe', () => {
  it('deletes matching rows scoped to the product-derived shop and email', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue({ shopId: 10 });
    prisma.notifysubscription.deleteMany.mockResolvedValue({ count: 1 });
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    const result = await service.unsubscribe('A@B.com', 1);

    expect(prisma.notifysubscription.deleteMany).toHaveBeenCalledWith({
      where: { shopId: 10, productId: 1, email: 'a@b.com' },
    });
    expect(result).toEqual({ success: true });
  });

  it('never reveals whether anything was actually subscribed — same response for a nonexistent product', async () => {
    const prisma = createMockPrisma();
    prisma.product.findUnique.mockResolvedValue(null);
    const service = new NotifySubscriptionsService(prisma, createMockJobsService());

    const result = await service.unsubscribe('nobody@b.com', 999);

    expect(result).toEqual({ success: true });
    expect(prisma.notifysubscription.deleteMany).not.toHaveBeenCalled();
  });
});

describe('NotifySubscriptionsService.triggerForProduct', () => {
  function fakeProduct() {
    return {
      id: 1,
      name: 'Rose Bouquet',
      thumbnail: 't.jpg',
      slug: 'rose-bouquet',
      shop: { subdomain: 'my-shop', name: 'My Shop' },
    };
  }

  it('queues an email job per subscriber and marks each notified', async () => {
    const prisma = createMockPrisma();
    const jobsService = createMockJobsService();
    prisma.product.findUnique.mockResolvedValue(fakeProduct());
    const subs = [
      { id: 1, email: 'a@b.com' },
      { id: 2, email: 'c@d.com' },
    ];
    prisma.notifysubscription.findMany.mockResolvedValue(subs);
    prisma.notifysubscription.update.mockResolvedValue({});
    const service = new NotifySubscriptionsService(prisma, jobsService);

    await service.triggerForProduct(10, 1);

    expect(jobsService.enqueue).toHaveBeenCalledTimes(2);
    expect(prisma.notifysubscription.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { notifiedAt: expect.any(Date) },
    });
    expect(prisma.notifysubscription.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it('a failure enqueuing one email in a batch does not prevent the others from being processed', async () => {
    const prisma = createMockPrisma();
    const jobsService = createMockJobsService();
    prisma.product.findUnique.mockResolvedValue(fakeProduct());
    prisma.notifysubscription.findMany.mockResolvedValue([
      { id: 1, email: 'bad@b.com' },
      { id: 2, email: 'good@d.com' },
    ]);
    jobsService.enqueue
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});
    prisma.notifysubscription.update.mockResolvedValue({});
    const service = new NotifySubscriptionsService(prisma, jobsService);

    await service.triggerForProduct(10, 1);

    // The failing subscriber never got marked notified (so a later stock
    // flip can retry it); the succeeding one did.
    expect(prisma.notifysubscription.update).toHaveBeenCalledTimes(1);
    expect(prisma.notifysubscription.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it('does nothing when there are no unnotified subscriptions', async () => {
    const prisma = createMockPrisma();
    const jobsService = createMockJobsService();
    prisma.product.findUnique.mockResolvedValue(fakeProduct());
    prisma.notifysubscription.findMany.mockResolvedValue([]);
    const service = new NotifySubscriptionsService(prisma, jobsService);

    await service.triggerForProduct(10, 1);

    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });
});
