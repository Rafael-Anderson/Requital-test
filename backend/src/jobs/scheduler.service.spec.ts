import { Prisma } from '@prisma/client';
import { SchedulerService } from './scheduler.service';
import type { PrismaService } from '../prisma/prisma.service';

function createMockPrisma() {
  return {
    scheduledjoblock: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService & {
    scheduledjoblock: {
      upsert: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
  };
}

describe('SchedulerService.runLocked', () => {
  it('runs fn and releases the lock when the claim succeeds', async () => {
    const prisma = createMockPrisma();
    prisma.scheduledjoblock.updateMany.mockResolvedValue({ count: 1 });
    const service = new SchedulerService(prisma);
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runLocked('sweep', 60, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(prisma.scheduledjoblock.update).toHaveBeenCalledWith({
      where: { name: 'sweep' },
      data: { lockedUntil: null },
    });
  });

  it('skips fn entirely when another instance already holds the lock', async () => {
    const prisma = createMockPrisma();
    prisma.scheduledjoblock.updateMany.mockResolvedValue({ count: 0 });
    const service = new SchedulerService(prisma);
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runLocked('sweep', 60, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(prisma.scheduledjoblock.update).not.toHaveBeenCalled();
  });

  it('still releases the lock if fn throws', async () => {
    const prisma = createMockPrisma();
    prisma.scheduledjoblock.updateMany.mockResolvedValue({ count: 1 });
    const service = new SchedulerService(prisma);
    const fn = jest.fn().mockRejectedValue(new Error('sweep blew up'));

    await expect(service.runLocked('sweep', 60, fn)).rejects.toThrow(
      'sweep blew up',
    );

    expect(prisma.scheduledjoblock.update).toHaveBeenCalledWith({
      where: { name: 'sweep' },
      data: { lockedUntil: null },
    });
  });

  it('tolerates a P2002 on the seed upsert — two first-ever ticks racing the same brand-new lock row still proceed to the real CAS claim', async () => {
    const prisma = createMockPrisma();
    const p2002 = new Prisma.PrismaClientKnownRequestError('Duplicate', {
      code: 'P2002',
      clientVersion: '6.0.0',
    });
    prisma.scheduledjoblock.upsert.mockRejectedValue(p2002);
    prisma.scheduledjoblock.updateMany.mockResolvedValue({ count: 1 });
    const service = new SchedulerService(prisma);
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runLocked('sweep', 60, fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
