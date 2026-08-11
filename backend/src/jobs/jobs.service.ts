import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError, isLockConflict } from '../database/mysql-errors';
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import type { JobRow } from '../db/types';
import type { JobPayload, JobType } from './jobs.types';

const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 3600;

export type JobRecord = JobRow;

// DB-backed job queue — see the Phase 5 report for why this was chosen over
// BullMQ+Redis. Claiming (claimNextJob) uses `FOR UPDATE SKIP LOCKED` so
// multiple worker processes/instances can poll the same table without ever
// claiming the same row twice; enqueue() is idempotent on `idempotencyKey`
// via the same catch-duplicate-key-and-return-the-winner idiom as
// PaymentsService.handleWebhook / InvoicesService.generateForOrder.
@Injectable()
export class JobsService {
  constructor(private readonly db: DatabaseService) {}

  // shopId is validated here, not left to the caller or the DB's FK
  // constraint — a missing/invalid shopId is rejected before a row is ever
  // written, per the Phase 5 spec's adversarial requirement. A duplicate
  // idempotencyKey is NOT an error: the caller gets back whichever job "won"
  // the insert, so enqueuing the same logical operation twice (a retried
  // request, a duplicate webhook, ...) still runs the underlying work
  // exactly once.
  //
  // `tx`: pass the surrounding transaction connection when enqueuing from
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
    options: {
      maxAttempts?: number;
      tx?: PoolConnection;
    } = {},
  ): Promise<JobRecord> {
    const { maxAttempts = 5, tx } = options;
    if (!Number.isInteger(shopId) || shopId <= 0) {
      throw new Error(
        `job enqueue rejected: invalid shopId (${JSON.stringify(shopId)})`,
      );
    }

    try {
      if (tx) {
        // updatedAt has no DB-level default (an @updatedAt field, same as
        // every other one in this schema — see CLAUDE.md's invoicecounter
        // note) so it's always set explicitly, on every insert.
        const [result] = await tx.query<ResultSetHeader>(
          `INSERT INTO job (shopId, type, payload, idempotencyKey, maxAttempts, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [shopId, type, JSON.stringify(payload), idempotencyKey, maxAttempts, new Date()],
        );
        const [rows] = await tx.query<RowDataPacket[]>(
          `SELECT * FROM job WHERE id = ?`,
          [result.insertId],
        );
        return this.parseJobRow(rows[0] as unknown as JobRow);
      }
      const result = await this.db.execute(
        `INSERT INTO job (shopId, type, payload, idempotencyKey, maxAttempts, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [shopId, type, JSON.stringify(payload), idempotencyKey, maxAttempts, new Date()],
      );
      const created = await this.findById(result.insertId);
      return created as JobRecord;
    } catch (error) {
      if (isDuplicateKeyError(error) || isLockConflict(error)) {
        const existing = await this.findByIdempotencyKey(idempotencyKey);
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
  // other.
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
    return this.db.transaction(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM job
         WHERE status = 'pending' AND nextAttemptAt <= ?
         ORDER BY nextAttemptAt ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [now],
      );
      if (rows.length === 0) return null;
      const id = rows[0].id as number;
      await conn.query(
        `UPDATE job SET status = 'processing', attempts = attempts + 1, updatedAt = ? WHERE id = ?`,
        [new Date(), id],
      );
      const [jobRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM job WHERE id = ?`,
        [id],
      );
      return this.parseJobRow(jobRows[0] as unknown as JobRow);
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
    const result = await this.db.execute(
      `UPDATE job SET status = 'processing', attempts = attempts + 1, updatedAt = ?
       WHERE id = ? AND status = 'pending' AND nextAttemptAt <= ?`,
      [new Date(), id, new Date()],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(id);
  }

  async completeJob(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE job SET status = 'completed', completedAt = ?, updatedAt = ? WHERE id = ?`,
      [new Date(), new Date(), id],
    );
  }

  // Retries with exponential backoff (30s, 60s, 120s, ... capped at 1h)
  // until attempts reaches maxAttempts, then the job is parked as
  // 'dead_letter' — terminal, never auto-retried again, visible in the
  // admin failed-jobs view (see listDeadLetter/retry/dismiss below).
  async failJob(id: number, errorMessage: string): Promise<void> {
    const job = await this.findById(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    if (job.attempts >= job.maxAttempts) {
      await this.db.execute(
        `UPDATE job SET status = 'dead_letter', lastError = ?, updatedAt = ? WHERE id = ?`,
        [errorMessage, new Date(), id],
      );
      return;
    }
    await this.db.execute(
      `UPDATE job SET status = 'pending', lastError = ?, nextAttemptAt = ?, updatedAt = ? WHERE id = ?`,
      [
        errorMessage,
        new Date(Date.now() + backoffSeconds(job.attempts) * 1000),
        new Date(),
        id,
      ],
    );
  }

  async listDeadLetter(shopId: number): Promise<JobRecord[]> {
    const rows = await this.db.query<(JobRow & RowDataPacket)[]>(
      `SELECT * FROM job WHERE shopId = ? AND status = 'dead_letter' ORDER BY updatedAt DESC`,
      [shopId],
    );
    return rows.map((row) => this.parseJobRow(row));
  }

  // Both scoped by (id, shopId) via an UPDATE checking affectedRows rather
  // than a plain find-then-update — a shop admin can only ever retry/dismiss
  // their own shop's failed jobs; a mismatched id/shopId pair (or an id
  // belonging to another shop) matches zero rows and 404s, never leaks or
  // mutates another tenant's job.
  async retry(shopId: number, id: number): Promise<void> {
    const result = await this.db.execute(
      `UPDATE job SET status = 'pending', attempts = 0, nextAttemptAt = ?, lastError = NULL, updatedAt = ?
       WHERE id = ? AND shopId = ? AND status = 'dead_letter'`,
      [new Date(), new Date(), id, shopId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException(`Failed job ${id} not found`);
    }
  }

  async dismiss(shopId: number, id: number): Promise<void> {
    const result = await this.db.execute(
      `UPDATE job SET status = 'dismissed', updatedAt = ? WHERE id = ? AND shopId = ? AND status = 'dead_letter'`,
      [new Date(), id, shopId],
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException(`Failed job ${id} not found`);
    }
  }

  private async findById(id: number): Promise<JobRecord | null> {
    const rows = await this.db.query<(JobRow & RowDataPacket)[]>(
      `SELECT * FROM job WHERE id = ?`,
      [id],
    );
    return rows[0] ? this.parseJobRow(rows[0]) : null;
  }

  private async findByIdempotencyKey(key: string): Promise<JobRecord | null> {
    const rows = await this.db.query<(JobRow & RowDataPacket)[]>(
      `SELECT * FROM job WHERE idempotencyKey = ?`,
      [key],
    );
    return rows[0] ? this.parseJobRow(rows[0]) : null;
  }

  // job.payload is a LONGTEXT column with only a `CHECK (json_valid(payload))`
  // constraint, not a real MySQL JSON column — so DatabaseService's
  // pool-level JSON auto-parsing (see CLAUDE.md's "Database access" note,
  // TINYINT(1)/JSON columns "come back already parsed") never applies to
  // it, and every read site got back the raw stored string. Every caller
  // downstream (JobsWorkerService, the per-type handlers) expects an
  // already-parsed object — every read site in this file routes through
  // here rather than each re-implementing the same typeof check.
  private parseJobRow(row: JobRow): JobRecord {
    return {
      ...row,
      payload:
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    };
  }
}

function backoffSeconds(attempts: number): number {
  return Math.min(
    BASE_BACKOFF_SECONDS * 2 ** Math.max(attempts - 1, 0),
    MAX_BACKOFF_SECONDS,
  );
}
