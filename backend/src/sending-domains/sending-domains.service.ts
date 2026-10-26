import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError, isLockConflict } from '../database/mysql-errors';
import { SchedulerService } from '../jobs/scheduler.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { createLogger } from '../common/logging/logger';
import { setSendingIdentityResolver } from '../common/email';
import type { TenantContext } from '../common/tenant-context';
import type { ShopsendingdomainRow } from '../db/types';
import {
  SENDING_DOMAINS_CLIENT,
  type SendingDomainRecord,
  type SendingDomainsClient,
} from './sending-domains.client';
import { SENDING_LOCAL_PART } from './sending-domain-platform-assumptions';
import {
  normalizeSendingDomain,
  sendingDomainProblem,
} from './sending-domain-validation';

const logger = createLogger('SendingDomains');

// Same recheck backoff as CustomDomainVerificationService.
const TIER_1_MAX_AGE_MS = 60 * 60 * 1000;
const TIER_2_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAIL_AFTER_MS = 48 * 60 * 60 * 1000;
const TIER_1_INTERVAL_MS = 5 * 60 * 1000;
const TIER_2_INTERVAL_MS = 30 * 60 * 1000;
const TIER_3_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVE = "('pending','verifying')";
const PROVIDER_DOWN = 'Could not reach the email provider. Try again shortly.';

export interface SendingDomainView {
  domain: string;
  status: ShopsendingdomainRow['status'];
  fromAddress: string;
  records: SendingDomainRecord[];
  lastError: string | null;
  verifiedAt: Date | null;
}

export interface VerifyResult {
  status: ShopsendingdomainRow['status'] | null;
  verified: boolean;
  message?: string;
}

type DomainRow = ShopsendingdomainRow & RowDataPacket;

@Injectable()
export class SendingDomainsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    @Inject(SENDING_DOMAINS_CLIENT)
    private readonly client: SendingDomainsClient,
    private readonly scheduler: SchedulerService,
    private readonly audit: AuditLogService,
  ) {}

  // common/email.ts is a plain module with no DI; this is how the send path
  // learns a shop's verified identity.
  onModuleInit() {
    setSendingIdentityResolver((shopId) => this.resolveIdentity(shopId));
  }

  static fromAddress(domain: string): string {
    return `${SENDING_LOCAL_PART}@${domain}`;
  }

  private toView(row: DomainRow): SendingDomainView {
    return {
      domain: row.domain,
      status: row.status,
      fromAddress: SendingDomainsService.fromAddress(row.domain),
      records: Array.isArray(row.recordsJson)
        ? (row.recordsJson as SendingDomainRecord[])
        : [],
      lastError: row.lastError,
      verifiedAt: row.verifiedAt,
    };
  }

  private async row(shopId: number): Promise<DomainRow | undefined> {
    const rows = await this.db.query<DomainRow[]>(
      `SELECT * FROM shopsendingdomain WHERE shopId = ?`,
      [shopId],
    );
    return rows[0];
  }

  async get(ctx: TenantContext): Promise<SendingDomainView | null> {
    const row = await this.row(ctx.shopId);
    return row ? this.toView(row) : null;
  }

  // Claim (or re-claim) a domain. Provider call first, outside any
  // transaction; the row is written only once the provider accepted it.
  async put(ctx: TenantContext, rawDomain: string): Promise<SendingDomainView> {
    const domain = normalizeSendingDomain(rawDomain);
    const problem = sendingDomainProblem(domain);
    if (problem) throw new BadRequestException(problem);

    const existing = await this.row(ctx.shopId);
    // Re-saving the same live claim is a no-op, not a reset.
    if (
      existing &&
      existing.domain === domain &&
      existing.status !== 'failed'
    ) {
      return this.toView(existing);
    }

    const taken = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM shopsendingdomain
       WHERE domain = ? AND status = 'verified' AND shopId <> ? LIMIT 1`,
      [domain, ctx.shopId],
    );
    if (taken.length > 0) {
      throw new ConflictException(
        'That domain is already used by another store.',
      );
    }

    // Drop the previous provider registration (best effort: a stale one at the
    // provider must not stop the merchant moving on).
    if (existing?.providerDomainId) {
      await this.client.deleteDomain(existing.providerDomainId).catch((err) =>
        logger.warn('provider delete of replaced sending domain failed', {
          shopId: ctx.shopId,
          error: String(err),
        }),
      );
    }

    const created = await this.client.createDomain(domain);

    try {
      await this.db.execute(
        `INSERT INTO shopsendingdomain
           (shopId, domain, status, providerDomainId, recordsJson, lastError, claimedAt, lastCheckedAt, verifiedAt)
         VALUES (?, ?, 'pending', ?, ?, NULL, ?, NULL, NULL)
         ON DUPLICATE KEY UPDATE
           domain = VALUES(domain), status = 'pending',
           providerDomainId = VALUES(providerDomainId),
           recordsJson = VALUES(recordsJson), lastError = NULL,
           claimedAt = VALUES(claimedAt), lastCheckedAt = NULL, verifiedAt = NULL,
           updatedAt = VALUES(claimedAt)`,
        [
          ctx.shopId,
          domain,
          created.providerId,
          JSON.stringify(created.records),
          new Date(),
        ],
      );
    } catch (err) {
      await this.client.deleteDomain(created.providerId).catch(() => undefined);
      throw err;
    }

    const row = (await this.row(ctx.shopId))!;
    await this.audit.logCtx(ctx, {
      action: 'sending_domain.set',
      entityType: 'sending_domain',
      entityId: row.id,
      after: { domain },
    });
    return this.toView(row);
  }

  // "Verify now" and the sweep. CAS transitions; provider calls never inside a
  // transaction.
  async verifyClaim(
    shopId: number,
    trigger: 'manual' | 'sweep' = 'manual',
  ): Promise<VerifyResult> {
    const row = await this.row(shopId);
    if (!row) throw new NotFoundException('No sending domain to verify.');
    if (row.status === 'verified')
      return { status: 'verified', verified: true };
    if (row.status === 'failed') {
      return {
        status: 'failed',
        verified: false,
        message: 'This claim has failed. Set the domain again to retry.',
      };
    }
    if (!row.providerDomainId) {
      return { status: row.status, verified: false, message: PROVIDER_DOWN };
    }

    let status;
    try {
      // Ask the provider to re-check DNS (UNVERIFIED that it does so alone), for
      // the manual button and once per sweep tick. Best effort: the status read
      // below is what decides.
      await this.client
        .requestVerification(row.providerDomainId)
        .catch(() => undefined);
      status = (await this.client.getDomain(row.providerDomainId)).status;
    } catch (err) {
      logger.warn('sending domain provider check failed', {
        shopId,
        trigger,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.db.execute(
        `UPDATE shopsendingdomain SET lastError = ?, lastCheckedAt = ?
         WHERE shopId = ? AND id = ? AND status IN ${ACTIVE}`,
        [PROVIDER_DOWN, new Date(), shopId, row.id],
      );
      return { status: row.status, verified: false, message: PROVIDER_DOWN };
    }

    const now = new Date();
    if (status === 'verified') {
      try {
        const res = await this.db.execute(
          `UPDATE shopsendingdomain
           SET status = 'verified', verifiedAt = ?, lastCheckedAt = ?, lastError = NULL
           WHERE shopId = ? AND id = ? AND domain = ? AND status IN ${ACTIVE}`,
          [now, now, shopId, row.id, row.domain],
        );
        if (res.affectedRows === 0) {
          return {
            status: 'pending',
            verified: false,
            message: 'The claim changed while verifying. Please try again.',
          };
        }
        logger.info('sending domain -> verified', {
          shopId,
          domain: row.domain,
          trigger,
        });
        return { status: 'verified', verified: true };
      } catch (err) {
        if (isDuplicateKeyError(err) || isLockConflict(err)) {
          const lost = await this.db.execute(
            `UPDATE shopsendingdomain SET status = 'failed', lastCheckedAt = ?, lastError = ?
             WHERE shopId = ? AND id = ? AND status IN ${ACTIVE}`,
            [now, 'That domain is used by another store.', shopId, row.id],
          );
          if (lost.affectedRows === 1) await this.releaseProvider(row);
          throw new ConflictException(
            'That domain was just verified by another store.',
          );
        }
        throw err;
      }
    }

    if (status === 'failed') {
      const failedNow = await this.db.execute(
        `UPDATE shopsendingdomain SET status = 'failed', lastCheckedAt = ?, lastError = ?
         WHERE shopId = ? AND id = ? AND status IN ${ACTIVE}`,
        [now, 'The provider could not verify the DNS records.', shopId, row.id],
      );
      if (failedNow.affectedRows === 1) await this.releaseProvider(row);
      return {
        status: 'failed',
        verified: false,
        message: 'The provider could not verify the DNS records.',
      };
    }

    await this.db.execute(
      `UPDATE shopsendingdomain SET status = 'verifying', lastCheckedAt = ?, lastError = NULL
       WHERE shopId = ? AND id = ? AND status IN ${ACTIVE}`,
      [now, shopId, row.id],
    );
    return {
      status: 'verifying',
      verified: false,
      message:
        'The DNS records are not visible yet. DNS changes can take a while to propagate.',
    };
  }

  // A failed claim no longer needs its provider registration: delete it so a
  // slot (and the hostname) is not held. Best effort, outside any transaction;
  // errors are swallowed and logged as their status-only message.
  private async releaseProvider(row: DomainRow): Promise<void> {
    if (!row.providerDomainId) return;
    try {
      await this.client.deleteDomain(row.providerDomainId);
      await this.db.execute(
        `UPDATE shopsendingdomain SET providerDomainId = NULL
         WHERE shopId = ? AND id = ? AND status = 'failed' AND providerDomainId = ?`,
        [row.shopId, row.id, row.providerDomainId],
      );
    } catch (err) {
      logger.warn('provider release of failed sending domain failed', {
        shopId: row.shopId,
        error: err instanceof Error ? err.message : 'error',
      });
    }
  }

  async verify(ctx: TenantContext): Promise<VerifyResult> {
    const res = await this.verifyClaim(ctx.shopId, 'manual');
    if (res.verified) {
      const row = await this.row(ctx.shopId);
      await this.audit.logCtx(ctx, {
        action: 'sending_domain.verified',
        entityType: 'sending_domain',
        entityId: row?.id,
        after: { domain: row?.domain },
      });
    }
    return res;
  }

  async remove(ctx: TenantContext): Promise<{ removed: boolean }> {
    const row = await this.row(ctx.shopId);
    if (!row) throw new NotFoundException('No sending domain is set.');
    if (row.providerDomainId) {
      await this.client.deleteDomain(row.providerDomainId).catch((err) =>
        logger.warn('provider delete of sending domain failed', {
          shopId: ctx.shopId,
          error: String(err),
        }),
      );
    }
    await this.db.execute(
      `DELETE FROM shopsendingdomain WHERE shopId = ? AND id = ?`,
      [ctx.shopId, row.id],
    );
    await this.audit.logCtx(ctx, {
      action: 'sending_domain.removed',
      entityType: 'sending_domain',
      entityId: row.id,
      before: { domain: row.domain },
    });
    return { removed: true };
  }

  // The send path's lookup. Only a VERIFIED domain yields an identity; any
  // other state (or no row) returns null and the caller uses the platform
  // address. Reply-To is the shop's own contact email when it has one.
  async resolveIdentity(
    shopId: number,
  ): Promise<{ fromAddress: string; replyTo?: string } | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT d.domain, s.email FROM shopsendingdomain d
       JOIN shop s ON s.id = d.shopId
       WHERE d.shopId = ? AND d.status = 'verified'`,
      [shopId],
    );
    const r = rows[0];
    if (!r) return null;
    const email = typeof r.email === 'string' ? r.email.trim() : '';
    return {
      fromAddress: SendingDomainsService.fromAddress(r.domain as string),
      ...(email && !/[\r\n<>",]/.test(email) ? { replyTo: email } : {}),
    };
  }

  async runSweep(): Promise<void> {
    const rows = await this.db.query<DomainRow[]>(
      // Oldest-checked first so a backlog is drained fairly across ticks.
      `SELECT * FROM shopsendingdomain WHERE status IN ${ACTIVE}
       ORDER BY lastCheckedAt IS NULL DESC, lastCheckedAt ASC LIMIT 100`,
    );
    const now = Date.now();
    for (const row of rows) {
      const ageMs = now - new Date(row.claimedAt).getTime();
      if (ageMs > FAIL_AFTER_MS) {
        const expired = await this.db.execute(
          `UPDATE shopsendingdomain SET status = 'failed', lastCheckedAt = ?, lastError = ?
           WHERE shopId = ? AND id = ? AND status IN ${ACTIVE}`,
          [
            new Date(),
            'Not verified within 48 hours. Set the domain again to retry.',
            row.shopId,
            row.id,
          ],
        );
        // Free the provider-side slot only if THIS update made it failed (a
        // claim that verified in the meantime is never released).
        if (expired.affectedRows === 1) await this.releaseProvider(row);
        continue;
      }
      const intervalMs =
        ageMs < TIER_1_MAX_AGE_MS
          ? TIER_1_INTERVAL_MS
          : ageMs < TIER_2_MAX_AGE_MS
            ? TIER_2_INTERVAL_MS
            : TIER_3_INTERVAL_MS;
      const since = row.lastCheckedAt
        ? now - new Date(row.lastCheckedAt).getTime()
        : Infinity;
      if (since < intervalMs) continue;
      try {
        await this.verifyClaim(row.shopId, 'sweep');
      } catch (err) {
        logger.debug('sending domain sweep resolved via exception', {
          shopId: row.shopId,
          error: String(err),
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepDueClaims(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.scheduler.runLocked('sending-domain-verify-sweep', 120, () =>
      this.runSweep(),
    );
  }
}
