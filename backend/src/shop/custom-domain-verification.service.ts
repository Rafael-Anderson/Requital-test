import { ConflictException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError, isLockConflict } from '../database/mysql-errors';
import { SchedulerService } from '../jobs/scheduler.service';
import { createLogger } from '../common/logging/logger';
import { DomainsService } from '../domains/domains.service';
import { DnsResolver } from './dns-resolver';
import {
  VERIFY_RECORD_PREFIX,
  type CustomDomainStatus,
} from './custom-domain.constants';

const logger = createLogger('CustomDomainVerification');

// Recheck backoff, keyed off how long ago the claim was created. Sign-off
// 2026-08-31 (docs/plans/custom-domain-resolver.md Phase 2):
//   < 1h   -> recheck every 5 min   (well-configured merchant auto-verifies fast)
//   1h-6h  -> every 30 min
//   6h-48h -> every 60 min
//   > 48h  -> failed (stop rechecking; merchant re-saves the domain to retry)
const TIER_1_MAX_AGE_MS = 60 * 60 * 1000;
const TIER_2_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAIL_AFTER_MS = 48 * 60 * 60 * 1000;
const TIER_1_INTERVAL_MS = 5 * 60 * 1000;
const TIER_2_INTERVAL_MS = 30 * 60 * 1000;
const TIER_3_INTERVAL_MS = 60 * 60 * 1000;

const ACTIVE = "('pending','verifying')";

export interface VerifyClaimResult {
  status: CustomDomainStatus | null;
  verified: boolean;
  message?: string;
}

interface ClaimRow extends RowDataPacket {
  customDomain: string | null;
  customDomainVerifyToken: string | null;
  customDomainStatus: string | null;
}

interface SweepRow extends RowDataPacket {
  id: number;
  customDomain: string | null;
  customDomainClaimedAt: Date | null;
  customDomainLastCheckedAt: Date | null;
}

// Phase 2 of docs/plans/custom-domain-resolver.md. Owns the DNS-TXT ownership
// check for a shop's custom-domain claim and the scheduled recheck sweep.
// Everything is compare-and-swap (no row lock is ever held across the DNS call),
// matching OrdersService's status-transition convention.
@Injectable()
export class CustomDomainVerificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly dns: DnsResolver,
    private readonly scheduler: SchedulerService,
    private readonly domains: DomainsService,
  ) {}

  // Runs the DNS TXT check for one shop's current claim and advances its
  // status. Shared by POST /shop/domain/verify ("Verify now", trigger =
  // 'manual') and runSweep() (trigger = 'sweep'). Every terminal transition
  // (verified / failed) invalidates the resolve cache for the host and is
  // logged so a "domain isn't working" report is debuggable from `pm2 logs`.
  async verifyClaim(
    shopId: number,
    trigger: 'manual' | 'sweep' = 'manual',
  ): Promise<VerifyClaimResult> {
    const rows = await this.db.query<ClaimRow[]>(
      `SELECT customDomain, customDomainVerifyToken, customDomainStatus
       FROM shop WHERE id = ?`,
      [shopId],
    );
    const claim = rows[0];
    if (!claim?.customDomain || !claim.customDomainVerifyToken) {
      return {
        status: (claim?.customDomainStatus as CustomDomainStatus) ?? null,
        verified: false,
        message: 'No custom domain claim to verify.',
      };
    }
    if (claim.customDomainStatus === 'verified') {
      return { status: 'verified', verified: true };
    }
    if (claim.customDomainStatus === 'failed') {
      return {
        status: 'failed',
        verified: false,
        message: 'This claim has failed. Re-save the domain to try again.',
      };
    }

    // Already verified by a different shop? Terminal-fail this claim and 409.
    const taken = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM shop
       WHERE customDomain = ? AND customDomainStatus = 'verified' AND id <> ? LIMIT 1`,
      [claim.customDomain, shopId],
    );
    if (taken.length > 0) {
      await this.db.execute(
        `UPDATE shop SET customDomainStatus = 'failed', customDomainLastCheckedAt = ?
         WHERE id = ? AND customDomainStatus IN ${ACTIVE}`,
        [new Date(), shopId],
      );
      this.domains.invalidate(claim.customDomain);
      logger.info(
        'custom-domain verify -> failed (already verified elsewhere)',
        {
          shopId,
          domain: claim.customDomain,
          trigger,
        },
      );
      throw new ConflictException(
        'That domain is already connected to another store.',
      );
    }

    const host = `${VERIFY_RECORD_PREFIX}.${claim.customDomain}`;
    let records: string[][] = [];
    try {
      records = await this.dns.resolveTxt(host);
    } catch {
      records = []; // ENOTFOUND / ENODATA / SERVFAIL -> "not there yet"
    }
    const token = claim.customDomainVerifyToken;
    const matched = records.some((chunks) => chunks.join('') === token);

    if (!matched) {
      await this.db.execute(
        `UPDATE shop SET customDomainStatus = 'verifying', customDomainLastCheckedAt = ?
         WHERE id = ? AND customDomainVerifyToken = ? AND customDomainStatus IN ${ACTIVE}`,
        [new Date(), shopId, token],
      );
      return {
        status: 'verifying',
        verified: false,
        message: `No matching TXT record at ${host} yet. DNS changes can take a while to propagate.`,
      };
    }

    // Matched — CAS the flip. The customDomainVerifiedKey generated column +
    // its UNIQUE index arbitrate a cross-shop race atomically here.
    try {
      const res = await this.db.execute(
        `UPDATE shop
         SET customDomainStatus = 'verified', customDomainVerifiedAt = ?, customDomainLastCheckedAt = ?
         WHERE id = ? AND customDomainVerifyToken = ? AND customDomainStatus IN ${ACTIVE}`,
        [new Date(), new Date(), shopId, token],
      );
      if (res.affectedRows === 0) {
        // Token rotated / disconnected under us between the read and the write.
        return {
          status: 'pending',
          verified: false,
          message: 'The claim changed while verifying. Please try again.',
        };
      }
      this.domains.invalidate(claim.customDomain);
      logger.info('custom-domain verify -> verified', {
        shopId,
        domain: claim.customDomain,
        trigger,
      });
      return { status: 'verified', verified: true };
    } catch (err) {
      if (isDuplicateKeyError(err) || isLockConflict(err)) {
        await this.db.execute(
          `UPDATE shop SET customDomainStatus = 'failed', customDomainLastCheckedAt = ?
           WHERE id = ? AND customDomainStatus IN ${ACTIVE}`,
          [new Date(), shopId],
        );
        this.domains.invalidate(claim.customDomain);
        logger.info('custom-domain verify -> failed (lost cross-shop race)', {
          shopId,
          domain: claim.customDomain,
          trigger,
        });
        throw new ConflictException(
          'That domain was just connected to another store.',
        );
      }
      throw err;
    }
  }

  // Public so an e2e spec can drive one sweep deterministically.
  async runSweep(): Promise<void> {
    const rows = await this.db.query<SweepRow[]>(
      `SELECT id, customDomain, customDomainClaimedAt, customDomainLastCheckedAt
       FROM shop WHERE customDomainStatus IN ${ACTIVE}`,
    );
    const now = Date.now();
    let checked = 0;
    let timedOut = 0;
    for (const row of rows) {
      const claimedAt = row.customDomainClaimedAt
        ? new Date(row.customDomainClaimedAt).getTime()
        : null;
      const ageMs = claimedAt !== null ? now - claimedAt : 0;

      if (claimedAt !== null && ageMs > FAIL_AFTER_MS) {
        await this.db.execute(
          `UPDATE shop SET customDomainStatus = 'failed', customDomainLastCheckedAt = ?
           WHERE id = ? AND customDomainStatus IN ${ACTIVE}`,
          [new Date(), row.id],
        );
        if (row.customDomain) this.domains.invalidate(row.customDomain);
        timedOut++;
        logger.info('custom-domain verify -> failed (48h window elapsed)', {
          shopId: row.id,
          domain: row.customDomain,
        });
        continue;
      }

      const intervalMs =
        ageMs < TIER_1_MAX_AGE_MS
          ? TIER_1_INTERVAL_MS
          : ageMs < TIER_2_MAX_AGE_MS
            ? TIER_2_INTERVAL_MS
            : TIER_3_INTERVAL_MS;
      const sinceLastCheck = row.customDomainLastCheckedAt
        ? now - new Date(row.customDomainLastCheckedAt).getTime()
        : Infinity;
      if (sinceLastCheck < intervalMs) continue;

      checked++;
      try {
        await this.verifyClaim(row.id, 'sweep');
      } catch (err) {
        // ConflictException (domain taken) has already terminal-failed the row.
        logger.debug('sweep verifyClaim resolved via exception (handled)', {
          shopId: row.id,
          error: String(err),
        });
      }
    }
    if (checked > 0 || timedOut > 0) {
      logger.info('custom-domain verify sweep', {
        active: rows.length,
        checked,
        timedOut,
      });
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepDueClaims(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.scheduler.runLocked('custom-domain-verify-sweep', 120, () =>
      this.runSweep(),
    );
  }
}
