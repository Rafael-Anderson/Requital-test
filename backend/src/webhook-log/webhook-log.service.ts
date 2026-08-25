import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { createLogger } from '../common/logging/logger';
import type { WebhookeventRow } from '../db/types';

const logger = createLogger('WebhookLogService');

export type WebhookLogResult = 'success' | 'duplicate' | 'rejected' | 'failed';

// A pure diagnostics log for Integrations > Webhooks — "did the webhook
// even arrive" is the #1 question a merchant asks when an order doesn't
// update. Written from PaymentsService.handleWebhook (every payment
// gateway) and SliderWebhookJobHandler (Slider). log() deliberately
// swallows its own write errors, same philosophy as AuditLogService.log —
// a broken log insert must never fail the real webhook processing it's
// describing.
@Injectable()
export class WebhookLogService {
  constructor(private readonly db: DatabaseService) {}

  async log(
    shopId: number,
    source: string,
    eventType: string,
    result: WebhookLogResult,
  ): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO webhookevent (shopId, source, eventType, result) VALUES (?, ?, ?, ?)`,
        [shopId, source, eventType, result],
      );
    } catch (error) {
      logger.warn('failed to write webhook log entry', {
        shopId,
        source,
        eventType,
        result,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async listRecent(shopId: number, limit = 20): Promise<WebhookeventRow[]> {
    return this.db.query<(WebhookeventRow & RowDataPacket)[]>(
      `SELECT * FROM webhookevent WHERE shopId = ? ORDER BY createdAt DESC LIMIT ?`,
      [shopId, limit],
    );
  }
}
