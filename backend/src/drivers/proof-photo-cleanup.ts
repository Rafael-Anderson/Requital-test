import { Injectable, OnModuleInit } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { DeleteProofPhotoJobPayload } from '../jobs/jobs.types';
import { StorageService } from '../storage/storage.service';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('ProofPhotoCleanup');

// A proof photo is removed through the job queue, never fire-and-forget: a
// storage outage retries with backoff, then dead-letters where an admin can see
// it (GET /jobs/failed), instead of leaving an orphan nobody knows about. The
// idempotency key is the file key, so scheduling twice is one job.
// Pass `tx` to commit the job with the row change that makes the file unwanted.
export async function scheduleProofDeletion(
  jobs: JobsService,
  shopId: number,
  key: string,
  tx?: PoolConnection,
): Promise<void> {
  try {
    await jobs.enqueue(
      shopId,
      'delete_proof_photo',
      { shopId, key },
      `proof-delete:${key}`,
      { tx },
    );
  } catch (error) {
    if (tx) throw error; // roll the caller's change back with it
    logger.error('could not schedule proof photo deletion', {
      shopId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// PDPL: a customer's anonymisation removes the delivery proof photos of their
// orders (a photo can show the person, the door, the house). The files go via
// the queue; the stop rows lose the key in the same transaction, so a retry of
// the anonymisation finds nothing left and the queue owns the retry of the delete.
export async function anonymiseCustomerDeliveryProofs(
  db: DatabaseService,
  jobs: JobsService,
  shopId: number,
  customerId: number,
): Promise<number> {
  return db.transaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT s.id, s.proofPhotoKey
         FROM deliveryrunstop s JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
        WHERE o.customerId = ? AND s.shopId = ? AND s.proofPhotoKey IS NOT NULL
        FOR UPDATE`,
      [customerId, shopId],
    );
    for (const r of rows) {
      await scheduleProofDeletion(jobs, shopId, r.proofPhotoKey as string, conn);
      await conn.query(
        `UPDATE deliveryrunstop SET proofPhotoKey = NULL, proofPhotoUrl = NULL, proofPhotoAt = NULL
          WHERE id = ? AND shopId = ?`,
        [r.id, shopId],
      );
    }
    return rows.length;
  });
}

@Injectable()
export class ProofPhotoCleanupHandler implements OnModuleInit {
  constructor(
    private readonly worker: JobsWorkerService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.worker.registerHandler('delete_proof_photo', async (payload) => {
      const { shopId, key } = payload as DeleteProofPhotoJobPayload;
      await this.storage.deleteProof(shopId, key);
    });
  }
}
