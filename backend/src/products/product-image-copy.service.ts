import { createHash } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { ImportCopyImageJobPayload } from '../jobs/jobs.types';
import { StorageService } from '../storage/storage.service';
import { createLogger } from '../common/logging/logger';
import { SafeFetchError, safeFetchImage } from '../common/safe-fetch';

const logger = createLogger('ProductImageCopy');

// Per import, so a hostile or huge file cannot queue unbounded outbound work.
export const MAX_COPY_IMAGES_PER_IMPORT = 500;
export const MAX_COPY_IMAGES_PER_PRODUCT = 10;
const IN_CHUNK = 500;
// A retry cannot fix most failures here, so the queue gives up quickly.
const JOB_MAX_ATTEMPTS = 3;

// One job per (shop, product, source URL). The key doubles as the ledger of
// "this URL was already copied for this product": once the product's image row
// holds OUR url instead of the remote one, the import can no longer see that it
// has the picture, so the classifier asks the ledger (copiedKeys below).
export function imageCopyKey(
  shopId: number,
  productId: number,
  url: string,
): string {
  return `imgcopy:${shopId}:${productId}:${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
}

export interface CopyRequest {
  productId: number;
  urls: string[];
}

// ONB-5 for the product importers: optionally copy the remote images a file
// listed into the app's own storage. The request never fetches anything: it
// only queues jobs after the import transaction has committed. The job runs
// the shared SSRF-safe fetcher.
@Injectable()
export class ProductImageCopyService implements OnModuleInit {
  // Replaceable in tests; production always uses the safe fetcher.
  fetchImage: typeof safeFetchImage = safeFetchImage;

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly worker: JobsWorkerService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.worker.registerHandler('import_copy_image', (payload) =>
      this.handle(payload as ImportCopyImageJobPayload),
    );
  }

  // How many of these would be queued, applying both caps. Pure; used by the
  // preview so the merchant sees the same numbers confirm will act on.
  static plan(requests: CopyRequest[]): {
    accepted: CopyRequest[];
    queued: number;
    skipped: number;
  } {
    const accepted: CopyRequest[] = [];
    let queued = 0;
    let skipped = 0;
    for (const r of requests) {
      const room = MAX_COPY_IMAGES_PER_IMPORT - queued;
      const take = Math.max(
        0,
        Math.min(r.urls.length, MAX_COPY_IMAGES_PER_PRODUCT, room),
      );
      skipped += r.urls.length - take;
      if (take > 0) {
        accepted.push({ productId: r.productId, urls: r.urls.slice(0, take) });
        queued += take;
      }
    }
    return { accepted, queued, skipped };
  }

  async enqueue(
    shopId: number,
    requests: CopyRequest[],
  ): Promise<{ queued: number; skipped: number }> {
    const plan = ProductImageCopyService.plan(requests);
    for (const r of plan.accepted) {
      for (const url of r.urls) {
        // Idempotent: the same URL for the same product is one job, ever.
        await this.jobs.enqueue(
          shopId,
          'import_copy_image',
          { shopId, productId: r.productId, url },
          imageCopyKey(shopId, r.productId, url),
          { maxAttempts: JOB_MAX_ATTEMPTS },
        );
      }
    }
    return { queued: plan.queued, skipped: plan.skipped };
  }

  // The subset of keys that already have a job (any status).
  async copiedKeys(shopId: number, keys: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    const unique = [...new Set(keys)];
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      const chunk = unique.slice(i, i + IN_CHUNK);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT idempotencyKey FROM job
         WHERE shopId = ? AND type = 'import_copy_image'
           AND idempotencyKey IN (${chunk.map(() => '?').join(', ')})`,
        [shopId, ...chunk],
      );
      for (const r of rows) found.add(r.idempotencyKey as string);
    }
    return found;
  }

  async handle(payload: ImportCopyImageJobPayload): Promise<void> {
    const { shopId, productId, url } = payload;
    // Still wanted? The product must belong to this shop and still list this
    // exact URL. A re-run after success finds nothing and does nothing.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT pi.id FROM productimage pi
         JOIN product p ON p.id = pi.productId
        WHERE pi.productId = ? AND p.shopId = ? AND pi.url = ?`,
      [productId, shopId, url],
    );
    if (rows.length === 0) return;

    let fetched: Awaited<ReturnType<typeof safeFetchImage>>;
    try {
      fetched = await this.fetchImage(url);
    } catch (error) {
      if (error instanceof SafeFetchError && !error.retryable) {
        // Blocked, wrong type, too large, 404: trying again changes nothing.
        // The product keeps the original remote URL. Only the host is logged.
        logger.warn('image copy refused', {
          shopId,
          productId,
          reason: error.reason,
          host: safeHost(url),
        });
        return;
      }
      // Retryable: let the queue back off and try again; it dead-letters after
      // JOB_MAX_ATTEMPTS and shows in Settings > Diagnostics.
      throw error;
    }

    const stored = await this.storage.uploadImage(shopId, 'products', {
      originalname: `imported.${fetched.ext}`,
      buffer: fetched.buffer,
    } as Express.Multer.File);
    if (stored.url.length > 191) {
      logger.warn('image copy refused', {
        shopId,
        productId,
        reason: 'stored_url_too_long',
      });
      return;
    }

    await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE productimage pi JOIN product p ON p.id = pi.productId
            SET pi.url = ?
          WHERE pi.productId = ? AND p.shopId = ? AND pi.url = ?`,
        [stored.url, productId, shopId, url],
      );
      await conn.query(
        `UPDATE product SET thumbnail = ? WHERE id = ? AND shopId = ? AND thumbnail = ?`,
        [stored.url, productId, shopId, url],
      );
    });
  }
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}
