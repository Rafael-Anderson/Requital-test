import { Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { hashToken } from '../common/token-hash';
import { CustomerConsentService } from '../customer-crm/customer-consent.service';
import { CONSENT_WORDING_VERSION } from '../customer-crm/consent-wording';
import { lockCustomerInShop } from '../customer-crm/customer-scope';

export const UNSUB_TOKEN_SHAPE = /^[0-9a-f]{32}$/;
const GENERIC_404 = 'This link is not valid';

// MKT-1. The unsubscribe link every campaign carries. The token is 128 random bits
// that exist in clear only in the email; the row keeps its SHA-256, so neither the
// address nor a sequential id is in the URL. Every unusable token (wrong shape,
// unknown, belongs to nothing) gets the same 404.
//
// Looking a link up never changes anything (mail scanners open links); only the
// POST does, and it is idempotent. What it writes, in ONE transaction:
//   - an emailsuppression row for (shop, address): the do-not-contact record every
//     audience subtracts, whatever consent rows say;
//   - a `withdrawn` email-consent event for every customer of the shop with that
//     address (an explicit "no", dated, with its source);
//   - the newsletter row, if any, back to unconfirmed (so a later re-subscribe goes
//     through confirmation again).
@Injectable()
export class CampaignUnsubscribeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly consent: CustomerConsentService,
  ) {}

  private async find(token: string | undefined) {
    if (!token || !UNSUB_TOKEN_SHAPE.test(token)) {
      throw new NotFoundException(GENERIC_404);
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT r.campaignId, r.shopId, r.email, s.name, s.displayName
         FROM campaignrecipient r JOIN shop s ON s.id = r.shopId
        WHERE r.unsubTokenHash = ?`,
      [hashToken(token)],
    );
    if (rows.length === 0) throw new NotFoundException(GENERIC_404);
    return rows[0];
  }

  async lookup(token: string | undefined) {
    const r = await this.find(token);
    return { shopName: (r.displayName as string | null) || (r.name as string) };
  }

  async unsubscribe(token: string | undefined) {
    const r = await this.find(token);
    const shopId = r.shopId as number;
    const email = r.email as string | null;
    // A scrubbed (anonymised) recipient has nothing left to act on.
    if (!email) return { unsubscribed: true as const };
    const shopName = (r.displayName as string | null) || (r.name as string);

    await this.db.transaction(async (conn) => {
      await conn.query(
        `INSERT INTO emailsuppression (shopId, email, reason, campaignId)
         VALUES (?, ?, 'unsubscribe', ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [shopId, email, r.campaignId],
      );
      const [custs] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM customer WHERE shopId = ? AND email = ? ORDER BY id`,
        [shopId, email],
      );
      for (const c of custs) {
        await lockCustomerInShop(conn, shopId, c.id as number);
        await this.consent.recordOn(conn, shopId, c.id as number, {
          channel: 'email',
          status: 'withdrawn',
          source: 'campaign_unsubscribe',
          wordingVersion: CONSENT_WORDING_VERSION,
          wordingText: `Unsubscribed from marketing emails from ${shopName} using the link in a campaign email.`,
        });
      }
      await conn.query(
        `UPDATE newslettersubscriber SET confirmedAt = NULL, confirmTokenHash = NULL
          WHERE shopId = ? AND email = ?`,
        [shopId, email],
      );
    });
    return { unsubscribed: true as const };
  }
}
