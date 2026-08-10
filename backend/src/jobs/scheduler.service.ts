import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('Scheduler');

// Cross-instance advisory lock for recurring sweeps (abandoned-cart
// recovery, low-stock digest) — see schema.prisma's comment on
// `scheduledjoblock` for why this is a CAS row instead of MySQL's
// GET_LOCK()/RELEASE_LOCK() (which doesn't survive connection-pool routing
// the acquire/release calls to two different physical connections).
@Injectable()
export class SchedulerService {
  constructor(private readonly db: DatabaseService) {}

  // Runs `fn` only if this instance wins the named lock for this tick; every
  // other instance racing the same tick sees `affectedRows === 0` and
  // returns immediately without running `fn` at all. `holdSeconds` should
  // comfortably exceed how long `fn` normally takes — a crashed holder isn't
  // explicitly released, it just expires naturally once `lockedUntil`
  // passes, so a crash can delay (never permanently block) the next run.
  async runLocked(
    name: string,
    holdSeconds: number,
    fn: () => Promise<void>,
  ): Promise<void> {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + holdSeconds * 1000);

    // Ensure the lock row exists before the CAS claim below — first-ever
    // tick for a given `name` has no row yet. MySQL's real
    // INSERT ... ON DUPLICATE KEY UPDATE is atomic against true concurrency
    // (unlike Prisma's old upsert, a SELECT-then-branch, not a true SQL
    // upsert), so two first-ever ticks racing this can no longer both think
    // they need to create the row — no catch-duplicate-and-ignore
    // workaround needed anymore. `name = VALUES(name)` on conflict is a
    // genuine no-op, leaving an existing row's lockedUntil untouched.
    await upsert(
      this.db.pool,
      'scheduledjoblock',
      { name, lockedUntil: null },
      ['name'],
    );

    const claimed = await this.db.execute(
      `UPDATE scheduledjoblock SET lockedUntil = ?
       WHERE name = ? AND (lockedUntil IS NULL OR lockedUntil < ?)`,
      [lockedUntil, name, now],
    );
    if (claimed.affectedRows === 0) {
      logger.debug(`schedule "${name}" already locked elsewhere — skipping`, {
        name,
      });
      return;
    }

    try {
      await fn();
    } finally {
      await this.db.execute(
        `UPDATE scheduledjoblock SET lockedUntil = NULL WHERE name = ?`,
        [name],
      );
    }
  }
}
