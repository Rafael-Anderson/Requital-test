import { SchedulerService } from './scheduler.service';
import type { DatabaseService } from '../database/database.service';

function createMockDb() {
  return {
    // upsert.util.ts calls this.db.pool.query(...) directly (bypassing the
    // DatabaseService wrapper) — the seed-upsert call in runLocked always
    // resolves via this, separate from the execute() mock below.
    pool: { query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) },
    query: jest.fn(),
    execute: jest.fn(),
  } as unknown as DatabaseService & { query: jest.Mock; execute: jest.Mock };
}

describe('SchedulerService.runLocked', () => {
  it('runs fn and releases the lock when the claim succeeds', async () => {
    const db = createMockDb();
    db.execute
      .mockResolvedValueOnce({ affectedRows: 1 }) // CAS claim
      .mockResolvedValueOnce({ affectedRows: 1 }); // release
    const service = new SchedulerService(db);
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runLocked('sweep', 60, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenLastCalledWith(
      expect.stringContaining('lockedUntil = NULL'),
      ['sweep'],
    );
  });

  it('skips fn entirely when another instance already holds the lock', async () => {
    const db = createMockDb();
    db.execute.mockResolvedValueOnce({ affectedRows: 0 }); // CAS claim loses
    const service = new SchedulerService(db);
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runLocked('sweep', 60, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1); // failed claim only, no release
  });

  it('still releases the lock if fn throws', async () => {
    const db = createMockDb();
    db.execute
      .mockResolvedValueOnce({ affectedRows: 1 }) // CAS claim
      .mockResolvedValueOnce({ affectedRows: 1 }); // release
    const service = new SchedulerService(db);
    const fn = jest.fn().mockRejectedValue(new Error('sweep blew up'));

    await expect(service.runLocked('sweep', 60, fn)).rejects.toThrow(
      'sweep blew up',
    );

    expect(db.execute).toHaveBeenLastCalledWith(
      expect.stringContaining('lockedUntil = NULL'),
      ['sweep'],
    );
  });

  // No more "tolerates a duplicate-key error on the seed upsert" test here —
  // that was covering Prisma's own upsert() not being a true atomic SQL
  // upsert (a SELECT-then-branch under the hood). MySQL's real
  // INSERT ... ON DUPLICATE KEY UPDATE (see upsert.util.ts) doesn't have
  // that race at all, so there's nothing left for this case to tolerate.
});
