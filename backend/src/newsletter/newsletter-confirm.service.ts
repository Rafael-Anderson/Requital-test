import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { FeaturesService } from '../features/features.service';
import { JobsService } from '../jobs/jobs.service';
import { hashToken } from '../common/token-hash';
import { storefrontUrl, type ShopUrlFields } from '../common/storefront-url';

// A confirmation link is re-sent at most this often per address (the widget is a
// public endpoint: it must not be a way to make us mail someone repeatedly).
const RESEND_AFTER_MS = 15 * 60 * 1000;
export const NEWSLETTER_TOKEN_SHAPE = /^[0-9a-f]{32}$/;

interface ShopForNewsletter extends ShopUrlFields {
  id: number;
  name: string;
  displayName: string | null;
}

// MKT-1. Double opt-in for NEW newsletter subscriptions, behind email_campaigns.
// A row is consent only once `confirmedAt` is set, by the link mailed to the
// address. Rows that exist already stay unconfirmed (no backfill); an address in
// that state that submits the widget again (while the flag is on) is mailed a
// confirmation, which is how an old subscriber can opt in properly.
//
// The token is 128 random bits, shown only in the email; the row keeps its
// SHA-256. Looking a link up never changes anything (a mail scanner that opens it
// cannot confirm); confirming is a POST from the storefront page.
@Injectable()
export class NewsletterConfirmService {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
    private readonly jobs: JobsService,
  ) {}

  // Behaviour with the flag OFF is exactly what the widget always did.
  async subscribe(
    shop: ShopForNewsletter,
    email: string,
  ): Promise<{ subscribed: true; confirmationRequired: boolean }> {
    const enabled = await this.features.isEnabled(shop.id, 'email_campaigns');
    try {
      const res = await this.db.execute(
        `INSERT INTO newslettersubscriber (shopId, email, source) VALUES (?, ?, ?)`,
        [shop.id, email, 'newsletter_widget'],
      );
      if (enabled) await this.issue(shop, res.insertId, email);
      return { subscribed: true, confirmationRequired: enabled };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      if (!enabled) {
        throw new ConflictException('This email is already subscribed');
      }
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id, confirmedAt, confirmSentAt FROM newslettersubscriber
          WHERE shopId = ? AND email = ?`,
        [shop.id, email],
      );
      const row = rows[0];
      if (!row || row.confirmedAt) {
        throw new ConflictException('This email is already subscribed');
      }
      const last = row.confirmSentAt
        ? new Date(row.confirmSentAt as Date).getTime()
        : 0;
      if (Date.now() - last >= RESEND_AFTER_MS) {
        await this.issue(shop, row.id as number, email);
      }
      return { subscribed: true, confirmationRequired: true };
    }
  }

  private async issue(shop: ShopForNewsletter, id: number, email: string) {
    const token = randomBytes(16).toString('hex');
    const tokenHash = hashToken(token);
    const res = await this.db.execute(
      `UPDATE newslettersubscriber SET confirmTokenHash = ?, confirmSentAt = ?
        WHERE id = ? AND shopId = ? AND confirmedAt IS NULL`,
      [tokenHash, new Date(), id, shop.id],
    );
    if (res.affectedRows === 0) return;
    const name = shop.displayName || shop.name;
    const url = storefrontUrl(shop, `/newsletter/confirm?token=${token}`);
    await this.jobs.enqueue(
      shop.id,
      'send_email',
      {
        to: email,
        subject: `Confirm your subscription to ${name}`,
        bodyText: `Please confirm that you want to receive marketing emails from ${name}:\n\n${url}\n\nIf you did not ask for this, ignore this email and you will not be subscribed.`,
        fromName: name,
      },
      `newsletter-confirm:${id}:${tokenHash.slice(0, 16)}`,
      // The body carries the live link: scrubbed once the job completes.
      { sensitive: true },
    );
  }

  private async findByToken(token: string | undefined) {
    if (!token || !NEWSLETTER_TOKEN_SHAPE.test(token)) {
      throw new NotFoundException('This link is not valid');
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT n.id, n.shopId, n.email, n.confirmedAt, s.name, s.displayName
         FROM newslettersubscriber n JOIN shop s ON s.id = n.shopId
        WHERE n.confirmTokenHash = ? AND s.suspendedAt IS NULL`,
      [hashToken(token)],
    );
    if (rows.length === 0)
      throw new NotFoundException('This link is not valid');
    return rows[0];
  }

  // Read only. Never confirms.
  async lookup(token: string | undefined) {
    const r = await this.findByToken(token);
    return {
      shopName: (r.displayName as string | null) || (r.name as string),
      confirmed: r.confirmedAt != null,
    };
  }

  // One CAS: the first call sets confirmedAt, any repeat is a harmless no-op. A
  // fresh opt-in also lifts an earlier UNSUBSCRIBE suppression (the person has now
  // asked again); a bounce, complaint or manual suppression stays.
  async confirm(token: string | undefined) {
    const r = await this.findByToken(token);
    const shopName = (r.displayName as string | null) || (r.name as string);
    await this.db.transaction(async (conn) => {
      const [res] = await conn.query<import('mysql2').ResultSetHeader>(
        `UPDATE newslettersubscriber SET confirmedAt = ?
          WHERE id = ? AND shopId = ? AND confirmedAt IS NULL`,
        [new Date(), r.id, r.shopId],
      );
      if (res.affectedRows > 0) {
        await conn.query(
          `DELETE FROM emailsuppression
            WHERE shopId = ? AND email = ? AND reason = 'unsubscribe'`,
          [r.shopId, r.email],
        );
      }
    });
    return { confirmed: true as const, shopName };
  }
}
