import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('Scheduler');

// Cross-instance advisory lock for recurring sweeps (abandoned-cart
// recovery, low-stock digest) — see schema.prisma's comment on
// `scheduledjoblock` for why this is a CAS row instead of MySQL's
// GET_LOCK()/RELEASE_LOCK() (which doesn't survive Prisma's connection
// pooling routing the acquire/release calls to two different physical
// connections).
@Injectable()
export class SchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  // Runs `fn` only if this instance wins the named lock for this tick; every
  // other instance racing the same tick sees `claimed.count === 0` and
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
    // tick for a given `name` has no row yet. Prisma's upsert is NOT atomic
    // against true concurrency (it's a SELECT then branch, not a real SQL
    // UPSERT) — two first-ever ticks racing this can both see no row and
    // both attempt `create`, so the loser's insert hits the PK unique
    // constraint. Caught and ignored here (same catch-P2002-and-no-op
    // idiom as PaymentsService.handleWebhook/InvoicesService.
    // generateForOrder): either way, by the time this line returns, the row
    // is guaranteed to exist for the real CAS claim right after to work
    // against. Found by an actual concurrent-call test failing, not by
    // inspection — an unconditional upsert() looked safe but wasn't.
    try {
      await this.prisma.scheduledjoblock.upsert({
        where: { name },
        create: { name, lockedUntil: null },
        update: {},
      });
    } catch (error) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034');
      if (!isDuplicate) throw error;
    }

    const claimed = await this.prisma.scheduledjoblock.updateMany({
      where: {
        name,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { lockedUntil },
    });
    if (claimed.count === 0) {
      logger.debug(`schedule "${name}" already locked elsewhere — skipping`, {
        name,
      });
      return;
    }

    try {
      await fn();
    } finally {
      await this.prisma.scheduledjoblock.update({
        where: { name },
        data: { lockedUntil: null },
      });
    }
  }
}
