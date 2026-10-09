import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { JobsService } from '../jobs/jobs.service';
import { normalizePhoneToE164 } from '../common/phone';
import { hashToken } from '../common/token-hash';
import { DeliveryRunsService } from './delivery-runs.service';
import { driverLinkUrl, LINK_TTL_HOURS, newLinkToken } from './driver-link';

export interface IssuedLink {
  url: string;
  expiresAt: Date;
  linkId: number;
}

// Staff side of the magic link: issue, revoke, send. The raw token exists only
// in the value returned from issue() (and the message sent from it); the table
// holds its hash. One live link per run: issuing a new one revokes the old.
@Injectable()
export class DriverLinksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly runs: DeliveryRunsService,
    private readonly branchRoles: BranchRolesService,
    private readonly audit: AuditLogService,
    private readonly jobs: JobsService,
  ) {}

  async issue(ctx: TenantContext, runId: number): Promise<IssuedLink> {
    const run = await this.runs.loadRun(ctx, runId, 'deliveries.manage');
    if (run.status !== 'dispatched' && run.status !== 'in_progress') {
      throw new ConflictException(
        'A link can only be issued for a dispatched run in progress',
      );
    }
    const token = newLinkToken();
    const linkId = await this.db.transaction(async (conn) => {
      // The driver must still be active, re-read inside the transaction.
      const [drivers] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM driver WHERE id = ? AND shopId = ? AND active = 1 FOR UPDATE`,
        [run.driverId, ctx.shopId],
      );
      if (drivers.length === 0) {
        throw new ConflictException('The assigned driver is not active');
      }
      const [live] = await conn.query<RowDataPacket[]>(
        `SELECT status FROM deliveryrun WHERE id = ? AND shopId = ? FOR UPDATE`,
        [runId, ctx.shopId],
      );
      if (!['dispatched', 'in_progress'].includes(live[0]?.status as string)) {
        throw new ConflictException('The run is no longer live');
      }
      await conn.query(
        `UPDATE deliveryrunlink SET revokedAt = NOW(3)
          WHERE runId = ? AND shopId = ? AND revokedAt IS NULL`,
        [runId, ctx.shopId],
      );
      const [res] = await conn.query(
        `INSERT INTO deliveryrunlink (shopId, runId, driverId, tokenHash, expiresAt, createdByUserId)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ${LINK_TTL_HOURS} HOUR), ?)`,
        [ctx.shopId, runId, run.driverId, hashToken(token), ctx.userId],
      );
      return (res as { insertId: number }).insertId;
    });
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT expiresAt FROM deliveryrunlink WHERE id = ? AND shopId = ?`,
      [linkId, ctx.shopId],
    );
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.link_issued',
      entityType: 'delivery_run',
      entityId: runId,
      // Never the token or its hash.
      metadata: { linkId, driverId: run.driverId },
    });
    return {
      url: driverLinkUrl(token),
      expiresAt: rows[0].expiresAt as Date,
      linkId,
    };
  }

  async revoke(ctx: TenantContext, runId: number) {
    await this.runs.loadRun(ctx, runId, 'deliveries.manage');
    const res = await this.db.execute(
      `UPDATE deliveryrunlink SET revokedAt = NOW(3)
        WHERE runId = ? AND shopId = ? AND revokedAt IS NULL`,
      [runId, ctx.shopId],
    );
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.link_revoked',
      entityType: 'delivery_run',
      entityId: runId,
      metadata: { revoked: res.affectedRows },
    });
    return { revoked: res.affectedRows };
  }

  // Issue a FRESH link and text it to the driver on WhatsApp through the
  // existing job queue (the platform WhatsApp account). The message carries the
  // link and nothing about the customers. The link is also in the job payload
  // until the queue prunes it; that is the price of using the queue (retries
  // after a provider failure), and it is no more than an admin who can mint a
  // link at will could read anyway.
  async sendWhatsApp(ctx: TenantContext, runId: number) {
    const run = await this.runs.loadRun(ctx, runId, 'deliveries.manage');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT d.name, d.phone, s.countryCode, COALESCE(s.displayName, s.name) AS shopName
         FROM driver d JOIN shop s ON s.id = d.shopId
        WHERE d.id = ? AND d.shopId = ?`,
      [run.driverId, ctx.shopId],
    );
    if (rows.length === 0) throw new NotFoundException('Driver not found');
    const to = normalizePhoneToE164(
      rows[0].phone as string,
      rows[0].countryCode as string | null,
    );
    if (!to) {
      throw new ConflictException(
        "The driver's phone number could not be used for WhatsApp",
      );
    }
    const link = await this.issue(ctx, runId);
    const firstStop = await this.db.query<RowDataPacket[]>(
      `SELECT orderId FROM deliveryrunstop WHERE runId = ? AND shopId = ? ORDER BY position LIMIT 1`,
      [runId, ctx.shopId],
    );
    await this.jobs.enqueue(
      ctx.shopId,
      'send_merchant_whatsapp_alert',
      {
        to,
        body: `Hi ${rows[0].name as string}, your delivery run for ${rows[0].shopName as string} is ready. Open it here: ${link.url} (valid for ${LINK_TTL_HOURS} hours)`,
        orderId: (firstStop[0]?.orderId as number | undefined) ?? 0,
      },
      `driver-link:${link.linkId}`,
    );
    return { url: link.url, expiresAt: link.expiresAt, queued: true };
  }

  // dispatch + a ready-to-copy link in one call.
  async dispatchWithLink(ctx: TenantContext, runId: number) {
    const run = await this.runs.dispatch(ctx, runId);
    if (run.status !== 'dispatched') return { ...run, issuedLink: null };
    const link = await this.issue(ctx, runId);
    return {
      ...run,
      issuedLink: { url: link.url, expiresAt: link.expiresAt },
    };
  }
}
