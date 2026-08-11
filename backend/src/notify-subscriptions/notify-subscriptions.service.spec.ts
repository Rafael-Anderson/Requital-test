import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotifySubscriptionsService } from './notify-subscriptions.service';
import type { DatabaseService } from '../database/database.service';
import type { JobsService } from '../jobs/jobs.service';

beforeEach(() => {
  jest.clearAllMocks();
});

function createMockJobsService() {
  return {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as JobsService & { enqueue: jest.Mock };
}

function createMockDb() {
  return {
    query: jest.fn(),
    execute: jest.fn().mockResolvedValue({ insertId: 1, affectedRows: 1 }),
  } as unknown as DatabaseService & { query: jest.Mock; execute: jest.Mock };
}

describe('NotifySubscriptionsService.subscribe', () => {
  it('creates a new subscription', async () => {
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, shopId: 10 }]) // product lookup
      .mockResolvedValueOnce([]) // findExisting
      .mockResolvedValueOnce([{ c: 0 }]) // rate-limit count
      .mockResolvedValueOnce([
        { id: 1, shopId: 10, productId: 1, variantId: null, email: 'a@b.com' },
      ]); // findById after insert
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    const result = await service.subscribe({ productId: 1, email: 'a@b.com' });

    expect(result.alreadySubscribed).toBe(false);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notifysubscription'),
      [10, 1, null, 'a@b.com'],
    );
  });

  it('is idempotent — returns the existing row instead of erroring on a duplicate', async () => {
    const db = createMockDb();
    const existing = {
      id: 5,
      shopId: 10,
      productId: 1,
      variantId: null,
      email: 'a@b.com',
    };
    db.query
      .mockResolvedValueOnce([{ id: 1, shopId: 10 }]) // product lookup
      .mockResolvedValueOnce([existing]); // findExisting

    const service = new NotifySubscriptionsService(db, createMockJobsService());
    const result = await service.subscribe({ productId: 1, email: 'a@b.com' });

    expect(result.alreadySubscribed).toBe(true);
    expect(result.subscription).toEqual(existing);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('rejects a productId that does not exist (also covers cross-shop spoofing — shopId is always derived server-side from the product, never accepted from the client)', async () => {
    const db = createMockDb();
    db.query.mockResolvedValueOnce([]); // product lookup finds nothing
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    await expect(
      service.subscribe({ productId: 999, email: 'a@b.com' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a variantId that does not belong to the product', async () => {
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, shopId: 10 }]) // product lookup
      .mockResolvedValueOnce([]); // variant lookup finds nothing
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    await expect(
      service.subscribe({ productId: 1, variantId: 99, email: 'a@b.com' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks a 4th new subscription from the same email within the hour', async () => {
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 2, shopId: 10 }]) // product lookup
      .mockResolvedValueOnce([]) // findExisting
      .mockResolvedValueOnce([{ c: 3 }]); // rate-limit count
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    await expect(
      service.subscribe({ productId: 2, email: 'a@b.com' }),
    ).rejects.toThrow(BadRequestException);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('does not count an idempotent duplicate against the rate limit', async () => {
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 2, shopId: 10 }]) // product lookup
      .mockResolvedValueOnce([
        { id: 1, shopId: 10, productId: 2, variantId: null, email: 'a@b.com' },
      ]); // findExisting
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    await service.subscribe({ productId: 2, email: 'a@b.com' });

    expect(db.query).toHaveBeenCalledTimes(2); // no rate-limit count query fired
  });
});

describe('NotifySubscriptionsService.unsubscribe', () => {
  it('deletes matching rows scoped to the product-derived shop and email', async () => {
    const db = createMockDb();
    db.query.mockResolvedValueOnce([{ shopId: 10 }]); // product lookup
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    const result = await service.unsubscribe('A@B.com', 1);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM notifysubscription'),
      [10, 1, 'a@b.com'],
    );
    expect(result).toEqual({ success: true });
  });

  it('never reveals whether anything was actually subscribed — same response for a nonexistent product', async () => {
    const db = createMockDb();
    db.query.mockResolvedValueOnce([]); // product lookup finds nothing
    const service = new NotifySubscriptionsService(db, createMockJobsService());

    const result = await service.unsubscribe('nobody@b.com', 999);

    expect(result).toEqual({ success: true });
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('NotifySubscriptionsService.triggerForProduct', () => {
  function fakeProductRow() {
    return {
      id: 1,
      name: 'Rose Bouquet',
      thumbnail: 't.jpg',
      slug: 'rose-bouquet',
      shopSubdomain: 'my-shop',
      shopName: 'My Shop',
    };
  }

  it('queues an email job per subscriber and marks each notified', async () => {
    const db = createMockDb();
    const jobsService = createMockJobsService();
    db.query
      .mockResolvedValueOnce([fakeProductRow()])
      .mockResolvedValueOnce([
        { id: 1, email: 'a@b.com' },
        { id: 2, email: 'c@d.com' },
      ]);
    const service = new NotifySubscriptionsService(db, jobsService);

    await service.triggerForProduct(10, 1);

    expect(jobsService.enqueue).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifysubscription'),
      [expect.any(Date), 1],
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifysubscription'),
      [expect.any(Date), 2],
    );
  });

  it('a failure enqueuing one email in a batch does not prevent the others from being processed', async () => {
    const db = createMockDb();
    const jobsService = createMockJobsService();
    db.query
      .mockResolvedValueOnce([fakeProductRow()])
      .mockResolvedValueOnce([
        { id: 1, email: 'bad@b.com' },
        { id: 2, email: 'good@d.com' },
      ]);
    jobsService.enqueue
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});
    const service = new NotifySubscriptionsService(db, jobsService);

    await service.triggerForProduct(10, 1);

    // The failing subscriber never got marked notified (so a later stock
    // flip can retry it); the succeeding one did.
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifysubscription'),
      [expect.any(Date), 2],
    );
  });

  it('does nothing when there are no unnotified subscriptions', async () => {
    const db = createMockDb();
    const jobsService = createMockJobsService();
    db.query.mockResolvedValueOnce([fakeProductRow()]).mockResolvedValueOnce([]);
    const service = new NotifySubscriptionsService(db, jobsService);

    await service.triggerForProduct(10, 1);

    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });
});
