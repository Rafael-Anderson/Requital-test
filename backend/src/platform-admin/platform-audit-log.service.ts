import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { createLogger } from '../common/logging/logger';
import type { PlatformauditlogentryRow } from '../db/types';

const logger = createLogger('PlatformAuditLogService');

// Deliberately the OPPOSITE swallow-errors philosophy of AuditLogService.
// log (see that file's own comment) — the scope here explicitly requires
// "every mutating platform admin action writes an audit log entry before
// returning," which for a cross-shop, security-sensitive action (suspend,
// impersonate, credential changes) means a failed audit write must fail the
// action itself rather than let it through silently unlogged. Every caller
// in PlatformAdminService awaits this before returning its own result.
@Injectable()
export class PlatformAuditLogService {
  constructor(private readonly db: DatabaseService) {}

  async log(
    platformAdminId: number,
    action: string,
    shopId: number | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO platformauditlogentry (platformAdminId, action, shopId, metadata) VALUES (?, ?, ?, ?)`,
        [
          platformAdminId,
          action,
          shopId,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
    } catch (error) {
      logger.error(
        'failed to write platform audit log entry — action blocked',
        {
          platformAdminId,
          action,
          shopId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw new InternalServerErrorException(
        'Could not record audit log entry; action was not completed',
      );
    }
  }

  async list(filters: {
    platformAdminId?: number;
    shopId?: number;
    limit?: number;
  }): Promise<PlatformauditlogentryRow[]> {
    const conditions: string[] = [];
    const params: QueryParam[] = [];
    if (filters.platformAdminId !== undefined) {
      conditions.push('platformAdminId = ?');
      params.push(filters.platformAdminId);
    }
    if (filters.shopId !== undefined) {
      conditions.push('shopId = ?');
      params.push(filters.shopId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filters.limit ?? 50);
    return this.db.query<(PlatformauditlogentryRow & RowDataPacket)[]>(
      `SELECT * FROM platformauditlogentry ${where} ORDER BY createdAt DESC LIMIT ?`,
      params,
    );
  }
}
