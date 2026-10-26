import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { FeaturesService } from '../features/features.service';
import { JobsService } from '../jobs/jobs.service';
import { JobsWorkerService } from '../jobs/jobs.worker.service';
import type { SendCampaignBatchJobPayload } from '../jobs/jobs.types';
import { SendingDomainsService } from '../sending-domains/sending-domains.service';
import { createLogger } from '../common/logging/logger';
import { sendEmailOrThrow } from '../common/email';
import { sanitizeHtml } from '../common/sanitize-html';
import { hashToken } from '../common/token-hash';
import { storefrontUrl } from '../common/storefront-url';
import { audienceSql } from './campaign-audience';
import { renderCampaignEmail, unsubscribeHeaders } from './campaign-email';
import { dailySendCap } from './campaigns.service';

const logger = createLogger('CampaignSender');

// One batch is small and the next one is chained a little later: a batch runs inside
// the job worker's tick, so this is what keeps campaign mail from holding up the
// transactional jobs queued behind it (they are due now; the next batch is not).
export const BATCH_SIZE = 20;
const BATCH_GAP_MS = 15_000;
// When the daily cap is reached the chain sleeps this long before looking again.
const CAP_WAIT_MS = 30 * 60_000;
// A claimed row that never reported back (the process died mid-send) is given up on
// after this long, as failed: it is never re-sent, because it may have gone out.
const STALE_CLAIM_MS = 15 * 60_000;

@Injectable()
export class CampaignSenderService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
    private readonly jobs: JobsService,
    private readonly worker: JobsWorkerService,
    private readonly sendingDomains: SendingDomainsService,
  ) {}

  onModuleInit() {
    this.worker.registerHandler('send_campaign_batch', (payload, shopId) =>
      this.runBatch(payload as SendCampaignBatchJobPayload, shopId),
    );
  }

  // Ends a campaign that cannot continue; its unsent rows are skipped with the reason.
  private async stop(
    campaignId: number,
    shopId: number,
    status: 'failed' | 'sent',
    reason: string | null,
  ) {
    const res = await this.db.execute(
      `UPDATE campaign SET status = ?, failureReason = ?, completedAt = ?, updatedAt = ?
        WHERE id = ? AND shopId = ? AND status = 'sending'`,
      [status, reason, new Date(), new Date(), campaignId, shopId],
    );
    if (res.affectedRows > 0 && status === 'failed') {
      await this.db.execute(
        `UPDATE campaignrecipient SET status = 'skipped', note = 'campaign stopped'
          WHERE campaignId = ? AND shopId = ? AND status = 'pending' AND claimedAt IS NULL`,
        [campaignId, shopId],
      );
    }
  }

  private async chain(
    p: SendCampaignBatchJobPayload,
    shopId: number,
    delayMs: number,
  ) {
    await this.jobs.enqueue(
      shopId,
      'send_campaign_batch',
      { campaignId: p.campaignId, batch: p.batch + 1 },
      `campaign:${p.campaignId}:batch:${p.batch + 1}`,
      { runAfter: new Date(Date.now() + delayMs) },
    );
  }

  // The job's own shopId is the tenant; the payload's campaign id is only honoured
  // inside it.
  async runBatch(
    p: SendCampaignBatchJobPayload,
    shopId: number,
  ): Promise<void> {
    const camps = await this.db.query<RowDataPacket[]>(
      `SELECT id, subject, bodyHtml, status FROM campaign WHERE id = ? AND shopId = ?`,
      [p.campaignId, shopId],
    );
    const campaign = camps[0];
    if (!campaign || campaign.status !== 'sending') return;

    // Re-checked on EVERY batch: switching the feature off or losing the verified
    // domain stops a running campaign instead of finishing it from somewhere else.
    const enabled = await this.features.isEnabled(shopId, 'email_campaigns');
    const identity = enabled
      ? await this.sendingDomains.resolveIdentity(shopId)
      : null;
    if (!enabled || !identity) {
      await this.stop(
        p.campaignId,
        shopId,
        'failed',
        enabled
          ? 'The sending domain is no longer verified'
          : 'Email campaigns were switched off for this shop',
      );
      return;
    }

    const sentRows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM campaignrecipient
        WHERE shopId = ? AND status = 'sent' AND sentAt >= ?`,
      [shopId, new Date(Date.now() - 24 * 3600_000)],
    );
    const room = dailySendCap() - Number(sentRows[0].n);
    if (room <= 0) {
      await this.chain(p, shopId, CAP_WAIT_MS);
      return;
    }

    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT name, displayName, legalName, address, email, subdomain, domainType,
              customDomain, customDomainStatus FROM shop WHERE id = ?`,
      [shopId],
    );
    const shop = shopRows[0];
    const shopName =
      (shop.displayName as string | null) || (shop.name as string);
    const body = sanitizeHtml(campaign.bodyHtml as string).html;

    const ids = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM campaignrecipient
        WHERE campaignId = ? AND shopId = ? AND status = 'pending' AND claimedAt IS NULL
        ORDER BY id LIMIT ?`,
      [p.campaignId, shopId, Math.min(BATCH_SIZE, room)],
    );
    for (const r of ids) {
      await this.sendOne(r.id as number, p.campaignId, shopId, {
        subject: campaign.subject as string,
        body,
        shop,
        shopName,
      });
    }

    const left = await this.db.query<RowDataPacket[]>(
      `SELECT SUM(claimedAt IS NULL) AS unclaimed, COUNT(*) AS pending
         FROM campaignrecipient WHERE campaignId = ? AND shopId = ? AND status = 'pending'`,
      [p.campaignId, shopId],
    );
    if (Number(left[0].unclaimed ?? 0) > 0) {
      await this.chain(p, shopId, BATCH_GAP_MS);
      return;
    }
    // Nothing left to claim. Anything still "pending" is claimed: give up on the
    // stale ones, and look again later for the recent ones.
    await this.db.execute(
      `UPDATE campaignrecipient SET status = 'failed', note = 'interrupted'
        WHERE campaignId = ? AND shopId = ? AND status = 'pending' AND claimedAt < ?`,
      [p.campaignId, shopId, new Date(Date.now() - STALE_CLAIM_MS)],
    );
    const still = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM campaignrecipient
        WHERE campaignId = ? AND shopId = ? AND status = 'pending'`,
      [p.campaignId, shopId],
    );
    if (Number(still[0].n) > 0) {
      await this.chain(p, shopId, STALE_CLAIM_MS);
      return;
    }
    await this.stop(p.campaignId, shopId, 'sent', null);
  }

  // At-most-once: the row is CLAIMED before anything is sent, and only a claimed row
  // is sent. A crash after the claim loses that one mail; it never sends it twice.
  private async sendOne(
    recipientId: number,
    campaignId: number,
    shopId: number,
    c: { subject: string; body: string; shop: RowDataPacket; shopName: string },
  ) {
    const token = randomBytes(16).toString('hex');
    // The join to campaign makes a cancel take effect on the very next row.
    const claim = await this.db.execute(
      `UPDATE campaignrecipient r JOIN campaign c ON c.id = r.campaignId AND c.shopId = r.shopId
          SET r.claimedAt = ?, r.unsubTokenHash = ?
        WHERE r.id = ? AND r.campaignId = ? AND r.shopId = ?
          AND r.status = 'pending' AND r.claimedAt IS NULL AND c.status = 'sending'`,
      [new Date(), hashToken(token), recipientId, campaignId, shopId],
    );
    if (claim.affectedRows === 0) return;

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT email FROM campaignrecipient WHERE id = ? AND shopId = ?`,
      [recipientId, shopId],
    );
    const email = rows[0]?.email as string | null | undefined;
    const finish = (
      status: 'sent' | 'skipped' | 'failed',
      note: string | null,
    ) =>
      this.db.execute(
        `UPDATE campaignrecipient SET status = ?, note = ?, sentAt = ?
          WHERE id = ? AND shopId = ? AND status = 'pending'`,
        [
          status,
          note,
          status === 'sent' ? new Date() : null,
          recipientId,
          shopId,
        ],
      );
    if (!email) {
      await finish('skipped', 'no address');
      return;
    }

    // Consent is asked again now, not trusted from the moment the audience was
    // frozen: a withdrawal, an unsubscribe or a suppression since then stops this mail.
    const a = audienceSql(shopId, null, email);
    const still = await this.db.query<RowDataPacket[]>(a.sql, a.params);
    if (still.length === 0) {
      await finish('skipped', 'no longer eligible');
      return;
    }

    const { html, text } = renderCampaignEmail({
      shopName: c.shopName,
      legalName: c.shop.legalName as string | null,
      address: c.shop.address as string | null,
      contactEmail: c.shop.email as string | null,
      bodyHtml: c.body,
      unsubscribeUrl: storefrontUrl(
        c.shop as never,
        `/unsubscribe?token=${token}`,
      ),
    });
    try {
      await sendEmailOrThrow(email, c.subject, text, {
        html,
        fromName: c.shopName,
        shopId,
        requireShopIdentity: true,
        headers: unsubscribeHeaders(
          storefrontUrl(
            c.shop as never,
            `/api/public/campaigns/unsubscribe?token=${token}`,
          ),
        ),
      });
      await finish('sent', null);
    } catch (err) {
      logger.warn('campaign send failed', {
        shopId,
        campaignId,
        recipientId,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
      await finish('failed', 'send failed');
    }
  }
}
