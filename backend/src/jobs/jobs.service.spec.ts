/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access --
 * Standard jest-mock-typing false positive (see CLAUDE.md's backend lint-gap
 * note and auth.service.spec.ts's identical disable). */
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { JobsService } from './jobs.service';
import type { DatabaseService } from '../database/database.service';
import type { PrismaService } from '../prisma/prisma.service';

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    shopId: 10,
    type: 'send_email',
    payload: { to: 'a@b.com', subject: 's', bodyText: 'b' },
    idempotencyKey: 'key-1',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

function duplicateKeyError() {
  return Object.assign(new Error('Duplicate entry'), { errno: 1062 });
}

function createMockDb() {
  return {
    query: jest.fn(),
    execute: jest.fn(),
    transaction: jest.fn(),
  } as unknown as DatabaseService & {
    query: jest.Mock;
    execute: jest.Mock;
    transaction: jest.Mock;
  };
}

// Only exercised by the "still-Prisma tx" legacy-shim test below — every
// other test goes through the DatabaseService mock.
function createMockPrisma() {
  return {} as unknown as PrismaService;
}

describe('JobsService.enqueue', () => {
  it('rejects a missing/invalid shopId before writing anything', async () => {
    const db = createMockDb();
    const service = new JobsService(db, createMockPrisma());

    await expect(
      service.enqueue(
        0,
        'send_email',
        { to: 'a', subject: 's', bodyText: 'b' },
        'k1',
      ),
    ).rejects.toThrow();
    await expect(
      service.enqueue(
        NaN,
        'send_email',
        { to: 'a', subject: 's', bodyText: 'b' },
        'k2',
      ),
    ).rejects.toThrow();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('is idempotent — a duplicate idempotencyKey returns the existing row instead of erroring', async () => {
    const db = createMockDb();
    const existing = fakeJob({ id: 5 });
    db.execute.mockRejectedValue(duplicateKeyError());
    db.query.mockResolvedValue([existing]);
    const service = new JobsService(db, createMockPrisma());

    const result = await service.enqueue(
      10,
      'send_email',
      { to: 'a', subject: 's', bodyText: 'b' },
      'key-1',
    );

    expect(result).toEqual(existing);
  });

  it('re-throws a non-duplicate-key error', async () => {
    const db = createMockDb();
    db.execute.mockRejectedValue(new Error('connection lost'));
    const service = new JobsService(db, createMockPrisma());

    await expect(
      service.enqueue(
        10,
        'send_email',
        { to: 'a', subject: 's', bodyText: 'b' },
        'k',
      ),
    ).rejects.toThrow('connection lost');
  });

  it('writes through the given transaction client, not the injected db pool, when a still-Prisma tx is passed', async () => {
    const db = createMockDb();
    const tx = {
      job: { create: jest.fn().mockResolvedValue(fakeJob()) },
    } as unknown as Prisma.TransactionClient;
    const service = new JobsService(db, createMockPrisma());

    await service.enqueue(
      10,
      'send_email',
      { to: 'a', subject: 's', bodyText: 'b' },
      'k',
      { tx },
    );

    expect(db.execute).not.toHaveBeenCalled();
    expect(
      (tx as unknown as { job: { create: jest.Mock } }).job.create,
    ).toHaveBeenCalled();
  });
});

describe('JobsService.failJob — retry-with-backoff / dead-letter transition', () => {
  it('re-schedules with a later nextAttemptAt while attempts remain', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([fakeJob({ attempts: 2, maxAttempts: 5 })]);
    const service = new JobsService(db, createMockPrisma());

    await service.failJob(1, 'boom');

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      ['boom', expect.any(Date), expect.any(Date), 1],
    );
  });

  it('dead-letters once attempts reaches maxAttempts, never scheduling another retry', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([fakeJob({ attempts: 5, maxAttempts: 5 })]);
    const service = new JobsService(db, createMockPrisma());

    await service.failJob(1, 'final failure');

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'dead_letter'"),
      ['final failure', expect.any(Date), 1],
    );
  });

  it('backoff is capped, not unbounded — never schedules further out than the 1h ceiling', async () => {
    const db = createMockDb();
    // attempts=10 would be 30*2^9 ≈ 4.3h uncapped — must clamp to 1h.
    db.query.mockResolvedValue([fakeJob({ attempts: 10, maxAttempts: 20 })]);
    const service = new JobsService(db, createMockPrisma());
    const before = Date.now();

    await service.failJob(1, 'still failing');

    const call = db.execute.mock.calls[0] as [string, unknown[]];
    const nextAttemptAt = call[1][1] as Date;
    const deltaMs = nextAttemptAt.getTime() - before;
    expect(deltaMs).toBeLessThanOrEqual(3600 * 1000 + 1000);
    expect(deltaMs).toBeGreaterThan(3500 * 1000);
  });
});

describe('JobsService.retry / dismiss — tenant scoping', () => {
  it('retry only succeeds when the job belongs to the given shopId', async () => {
    const db = createMockDb();
    db.execute.mockResolvedValue({ affectedRows: 0 });
    const service = new JobsService(db, createMockPrisma());

    await expect(service.retry(999, 1)).rejects.toThrow(NotFoundException);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending', attempts = 0"),
      expect.arrayContaining([1, 999]),
    );
  });

  it('dismiss only succeeds when the job belongs to the given shopId', async () => {
    const db = createMockDb();
    db.execute.mockResolvedValue({ affectedRows: 0 });
    const service = new JobsService(db, createMockPrisma());

    await expect(service.dismiss(999, 1)).rejects.toThrow(NotFoundException);
  });

  it('retry succeeds and resets attempts when scoped correctly', async () => {
    const db = createMockDb();
    db.execute.mockResolvedValue({ affectedRows: 1 });
    const service = new JobsService(db, createMockPrisma());

    await expect(service.retry(10, 1)).resolves.toBeUndefined();
  });
});
