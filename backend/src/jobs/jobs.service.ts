import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { job as JobRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { JobPayload, JobType } from './jobs.types';

const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 3600;

// DB-backed job queue — see the Phase 5 report for why this was chosen over
// BullMQ+Redis. Claiming (claimNextJob) uses `FOR UPDATE SKIP LOCKED` so
// multiple worker processes/instances can poll the same table without ever
// claiming the same row twice; enqueue() is idempotent on `idempotencyKey`
// via the same catch-P2002-and-return-the-winner idiom as
// PaymentsService.handleWebhook / InvoicesService.generateForOrder.
@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  // shopId is validated here, not left to the caller or the DB's FK
  // constraint — a missing/invalid shopId is rejected before a row is ever
  // written, per the Phase 5 spec's adversarial requirement. A duplicate
  // idempotencyKey is NOT an error: the caller gets back whichever job "won"
  // the insert, so enqueuing the same logical operation twice (a retried
  // request, a duplicate webhook, ...) still runs the underlying work
  // exactly once.
  //
  // `tx`: pass the surrounding Prisma.TransactionClient when enqueuing from
  // inside an existing transaction (e.g. GiftCardsService.issueForOrder,
  // called mid order-creation transaction) — this is what makes the job row
  // commit-or-rollback atomically with the work it describes, rather than
  // being written on a separate connection outside that transaction and
  // potentially outliving a later rollback.
  async enqueue(
    shopId: number,
    type: JobType,
    payload: JobPayload,
    idempotencyKey: string,
    options: { maxAttempts?: number; tx?: Prisma.TransactionClient } = {},
  ): Promise<JobRecord> {
    const { maxAttempts = 5, tx } = options;
    const client = tx ?? this.prisma;
    if (!Number.isInteger(shopId) || shopId <= 0) {
      throw new Error(
        `job enqueue rejected: invalid shopId (${JSON.stringify(shopId)})`,
      );
    }
    try {
      return await client.job.create({
        data: {
          shopId,
          type,
          payload: payload as unknown as Prisma.InputJsonValue,
          idempotencyKey,
          maxAttempts,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        const existing = await client.job.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  // Atomically claims (at most) one due job so concurrent pollers — whether
  // multiple @Interval ticks in one process or multiple app instances — can
  // never both pick up the same row. `FOR UPDATE SKIP LOCKED` (MySQL 8+) is
  // what makes this safe: a row already locked by another claimer is simply
  // skipped rather than blocked on, so pollers never queue up behind each
  // other. Prisma has no query-builder API for SKIP LOCKED, hence the raw
  // SQL — same "raw SQL where Prisma can't express it" precedent as
  // InvoicesService.nextInvoiceNumber and the dashboard's grouped-by-derived-
  // expression queries.
  //
  // Binds a JS `Date` rather than using SQL `NOW()` — found for real, not by
  // inspection: this session's local dev MySQL server's own clock runs ~4h
  // ahead of the Node process (its `time_zone` session var is set to UAE
  // time, matching DashboardService's own documented UTC+4 workaround
  // elsewhere in this codebase), so a query mixing MySQL's `NOW()` against a
  // `nextAttemptAt` column written from `Date.now()` compares two different
  // clocks — every retry's backoff delay was computed correctly but then
  // immediately reclaimable anyway, since the DB's own `NOW()` was already
  // hours past it. Binding the same JS clock both places (this file always
  // writes `nextAttemptAt` via `new Date(...)`) keeps the comparison
  // internally consistent regardless of the DB server's own clock/timezone.
  async claimNextJob(): Promise<JobRecord | null> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM job
        WHERE status = 'pending' AND nextAttemptAt <= ${now}
        ORDER BY nextAttemptAt ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
      return tx.job.update({
        where: { id: rows[0].id },
        data: { status: 'processing', attempts: { increment: 1 } },
      });
    });
  }

  // Claims one specific job by id (rather than claimNextJob's "whatever's
  // next due" ordering) via the same pending+due CAS check, just without the
  // SKIP LOCKED contention-avoidance claimNextJob needs when many pollers
  // compete for an unknown next row — here the caller already knows exactly
  // which row it wants. Used by jobs.e2e-spec.ts to drive a single job's
  // retry sequence deterministically without racing whatever else is
  // enqueued in the shared test database at the same time; a future
  // "process this job now" admin action would reuse it too.
  async claimJobById(id: number): Promise<JobRecord | null> {
    const result = await this.prisma.job.updateMany({
      where: { id, status: 'pending', nextAttemptAt: { lte: new Date() } },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.prisma.job.findUnique({ where: { id } });
  }

  async completeJob(id: number): Promise<void> {
    await this.prisma.job.update({
      where: { id },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  // Retries with exponential backoff (30s, 60s, 120s, ... capped at 1h)
  // until attempts reaches maxAttempts, then the job is parked as
  // 'dead_letter' — terminal, never auto-retried again, visible in the
  // admin failed-jobs view (see listDeadLetter/retry/dismiss below).
  async failJob(id: number, errorMessage: string): Promise<void> {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id } });
    if (job.attempts >= job.maxAttempts) {
      await this.prisma.job.update({
        where: { id },
        data: { status: 'dead_letter', lastError: errorMessage },
      });
      return;
    }
    await this.prisma.job.update({
      where: { id },
      data: {
        status: 'pending',
        lastError: errorMessage,
        nextAttemptAt: new Date(
          Date.now() + backoffSeconds(job.attempts) * 1000,
        ),
      },
    });
  }

  async listDeadLetter(shopId: number): Promise<JobRecord[]> {
    return this.prisma.job.findMany({
      where: { shopId, status: 'dead_letter' },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Both scoped by (id, shopId) via updateMany rather than a plain
  // findUnique-then-update — a shop admin can only ever retry/dismiss their
  // own shop's failed jobs; a mismatched id/shopId pair (or an id belonging
  // to another shop) matches zero rows and 404s, never leaks or mutates
  // another tenant's job.
  async retry(shopId: number, id: number): Promise<void> {
    const result = await this.prisma.job.updateMany({
      where: { id, shopId, status: 'dead_letter' },
      data: {
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Failed job ${id} not found`);
    }
  }

  async dismiss(shopId: number, id: number): Promise<void> {
    const result = await this.prisma.job.updateMany({
      where: { id, shopId, status: 'dead_letter' },
      data: { status: 'dismissed' },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Failed job ${id} not found`);
    }
  }
}

function backoffSeconds(attempts: number): number {
  return Math.min(
    BASE_BACKOFF_SECONDS * 2 ** Math.max(attempts - 1, 0),
    MAX_BACKOFF_SECONDS,
  );
}
