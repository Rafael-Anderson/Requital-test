/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access --
 * Standard jest-mock-typing false positive (see CLAUDE.md's backend lint-gap
 * note and auth.service.spec.ts's identical disable). */
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobsService } from './jobs.service';
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

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ...overrides,
  } as unknown as PrismaService & {
    job: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
}

describe('JobsService.enqueue', () => {
  it('rejects a missing/invalid shopId before writing anything', async () => {
    const prisma = createMockPrisma();
    const service = new JobsService(prisma);

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
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it('is idempotent — a duplicate idempotencyKey returns the existing row instead of erroring', async () => {
    const prisma = createMockPrisma();
    const existing = fakeJob({ id: 5 });
    const p2002 = new Prisma.PrismaClientKnownRequestError('Duplicate', {
      code: 'P2002',
      clientVersion: '6.0.0',
    });
    prisma.job.create.mockRejectedValue(p2002);
    prisma.job.findUnique.mockResolvedValue(existing);
    const service = new JobsService(prisma);

    const result = await service.enqueue(
      10,
      'send_email',
      { to: 'a', subject: 's', bodyText: 'b' },
      'key-1',
    );

    expect(result).toEqual(existing);
  });

  it('re-throws a non-duplicate-key error', async () => {
    const prisma = createMockPrisma();
    prisma.job.create.mockRejectedValue(new Error('connection lost'));
    const service = new JobsService(prisma);

    await expect(
      service.enqueue(
        10,
        'send_email',
        { to: 'a', subject: 's', bodyText: 'b' },
        'k',
      ),
    ).rejects.toThrow('connection lost');
  });

  it('writes through the given transaction client, not the injected prisma, when tx is passed', async () => {
    const prisma = createMockPrisma();
    const tx = {
      job: { create: jest.fn().mockResolvedValue(fakeJob()) },
    } as unknown as Prisma.TransactionClient;
    const service = new JobsService(prisma);

    await service.enqueue(
      10,
      'send_email',
      { to: 'a', subject: 's', bodyText: 'b' },
      'k',
      { tx },
    );

    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(
      (tx as unknown as { job: { create: jest.Mock } }).job.create,
    ).toHaveBeenCalled();
  });
});

describe('JobsService.failJob — retry-with-backoff / dead-letter transition', () => {
  it('re-schedules with a later nextAttemptAt while attempts remain', async () => {
    const prisma = createMockPrisma();
    prisma.job.findUniqueOrThrow.mockResolvedValue(
      fakeJob({ attempts: 2, maxAttempts: 5 }),
    );
    const service = new JobsService(prisma);

    await service.failJob(1, 'boom');

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'pending',
        lastError: 'boom',
        nextAttemptAt: expect.any(Date),
      }),
    });
  });

  it('dead-letters once attempts reaches maxAttempts, never scheduling another retry', async () => {
    const prisma = createMockPrisma();
    prisma.job.findUniqueOrThrow.mockResolvedValue(
      fakeJob({ attempts: 5, maxAttempts: 5 }),
    );
    const service = new JobsService(prisma);

    await service.failJob(1, 'final failure');

    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'dead_letter', lastError: 'final failure' },
    });
  });

  it('backoff is capped, not unbounded — never schedules further out than the 1h ceiling', async () => {
    const prisma = createMockPrisma();
    // attempts=10 would be 30*2^9 ≈ 4.3h uncapped — must clamp to 1h.
    prisma.job.findUniqueOrThrow.mockResolvedValue(
      fakeJob({ attempts: 10, maxAttempts: 20 }),
    );
    const service = new JobsService(prisma);
    const before = Date.now();

    await service.failJob(1, 'still failing');

    const call = prisma.job.update.mock.calls[0][0] as {
      data: { nextAttemptAt: Date };
    };
    const deltaMs = call.data.nextAttemptAt.getTime() - before;
    expect(deltaMs).toBeLessThanOrEqual(3600 * 1000 + 1000);
    expect(deltaMs).toBeGreaterThan(3500 * 1000);
  });
});

describe('JobsService.retry / dismiss — tenant scoping', () => {
  it('retry only succeeds when the job belongs to the given shopId', async () => {
    const prisma = createMockPrisma();
    prisma.job.updateMany.mockResolvedValue({ count: 0 });
    const service = new JobsService(prisma);

    await expect(service.retry(999, 1)).rejects.toThrow(NotFoundException);
    expect(prisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: 1, shopId: 999, status: 'dead_letter' },
      data: expect.objectContaining({ status: 'pending', attempts: 0 }),
    });
  });

  it('dismiss only succeeds when the job belongs to the given shopId', async () => {
    const prisma = createMockPrisma();
    prisma.job.updateMany.mockResolvedValue({ count: 0 });
    const service = new JobsService(prisma);

    await expect(service.dismiss(999, 1)).rejects.toThrow(NotFoundException);
  });

  it('retry succeeds and resets attempts when scoped correctly', async () => {
    const prisma = createMockPrisma();
    prisma.job.updateMany.mockResolvedValue({ count: 1 });
    const service = new JobsService(prisma);

    await expect(service.retry(10, 1)).resolves.toBeUndefined();
  });
});
