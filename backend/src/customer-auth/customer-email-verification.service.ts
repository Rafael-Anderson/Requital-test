import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { JobsService } from '../jobs/jobs.service';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import { escapeHtml } from '../common/email';
import { storefrontUrl } from '../common/storefront-url';
import type { CustomerRow, ShopRow } from '../db/types';
import { renderCustomerLinkEmail } from './customer-link-email';

const VERIFY_TOKEN_LIFETIME_HOURS = 24;
// Per customer: one link a minute to the same address, five an hour in all,
// however many requests arrive.
// Counted from the token table itself, so it holds across processes and cannot be
// reset by changing IP. A refused send is silent: the caller always gets the same
// generic answer.
const MIN_GAP_SECONDS = 60;
const MAX_PER_HOUR = 5;

// Email verification for storefront accounts. The one place that decides which
// address is trusted: verifiedEmail is written here and nowhere else, and only
// for the exact address a token was issued to (customerauthtoken.targetEmail) if
// that is still the account's email.
@Injectable()
export class CustomerEmailVerificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
  ) {}

  // Sends a link to the account's CURRENT email. Never throws for "nothing to
  // do" (no email, not registered, throttled): the answer to the caller is the
  // same either way.
  async sendForCustomer(shop: ShopRow, customer: CustomerRow): Promise<void> {
    const email = customer.email;
    if (!email || !customer.passwordHash) return;
    if (
      customer.verifiedEmail &&
      customer.verifiedEmail.toLowerCase() === email.toLowerCase()
    ) {
      return; // already proven
    }
    const recent = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS perHour,
              COALESCE(SUM(createdAt > ? AND targetEmail = ?), 0) AS lastMinute
         FROM customerauthtoken
        WHERE customerId = ? AND purpose = 'email_verify' AND createdAt > ?`,
      [
        new Date(Date.now() - MIN_GAP_SECONDS * 1000),
        email,
        customer.id,
        new Date(Date.now() - 60 * 60 * 1000),
      ],
    );
    if (
      Number(recent[0].lastMinute) > 0 ||
      Number(recent[0].perHour) >= MAX_PER_HOUR
    ) {
      return;
    }

    const raw = generateOpaqueToken();
    const now = new Date();
    // Only the newest link works: an older one for a since-replaced address is
    // retired here rather than left valid until it expires.
    await this.db.execute(
      `UPDATE customerauthtoken SET usedAt = ? WHERE customerId = ? AND purpose = 'email_verify' AND usedAt IS NULL`,
      [now, customer.id],
    );
    const inserted = await this.db.execute(
      `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt, targetEmail) VALUES (?, 'email_verify', ?, ?, ?)`,
      [
        customer.id,
        hashToken(raw),
        new Date(now.getTime() + VERIFY_TOKEN_LIFETIME_HOURS * 3600 * 1000),
        email,
      ],
    );
    const link = storefrontUrl(shop, `/account/verify-email?token=${raw}`);
    const shopDisplayName = shop.displayName ?? shop.name;
    await this.jobs.enqueue(
      shop.id,
      'send_email',
      {
        to: email,
        subject: 'Verify your email',
        bodyText: `Verify your email address: ${link}\nThis link expires in ${VERIFY_TOKEN_LIFETIME_HOURS} hours.`,
        html: renderCustomerLinkEmail({
          greetingName: customer.name,
          shopDisplayName,
          intro: `Please confirm this email address for your ${shopDisplayName} account. It is the only address we will send a password reset to. This link expires in ${VERIFY_TOKEN_LIFETIME_HOURS} hours.`,
          buttonLabel: 'Verify email',
          link,
          ignoreNote: "If you didn't create this account, you can ignore this email.",
        }),
        fromName: shopDisplayName,
      },
      // The token row's id, not the raw token: the key is stored in clear.
      `customer-email-verify:${customer.id}:${inserted.insertId}`,
    );
  }

  // Tells the previously verified address that the account's email was changed.
  // Deliberately says nothing about the new address.
  async sendEmailChangedNotice(
    shop: ShopRow,
    name: string,
    oldVerifiedEmail: string,
  ): Promise<void> {
    const shopDisplayName = shop.displayName ?? shop.name;
    const text = `The email address on your ${shopDisplayName} account was changed. Password resets still go to this address until the new one is verified. If this was not you, reset your password now.`;
    await this.jobs.enqueue(
      shop.id,
      'send_email',
      {
        to: oldVerifiedEmail,
        subject: 'Your account email was changed',
        bodyText: text,
        html: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(text)}</p>`,
        fromName: shopDisplayName,
      },
      `customer-email-changed:${shop.id}:${generateOpaqueToken().slice(0, 16)}`,
    );
  }

  // Consumes a link. Everything is one transaction: the single-use claim, the
  // write of verifiedEmail, and the retirement of reset links minted for the
  // address being replaced, so none of them can half-happen.
  async confirm(token: string): Promise<{ success: true }> {
    const invalid = () =>
      new BadRequestException('This verification link is invalid or has expired');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM customerauthtoken WHERE tokenHash = ?`,
      [hashToken(token)],
    );
    const stored = rows[0];
    if (
      !stored ||
      stored.purpose !== 'email_verify' ||
      !stored.targetEmail ||
      (stored.expiresAt as Date) < new Date()
    ) {
      throw invalid();
    }
    try {
      await this.db.transaction(async (conn) => {
        const [claimed] = await conn.query<ResultSetHeader>(
          `UPDATE customerauthtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
          [new Date(), stored.id],
        );
        if (claimed.affectedRows === 0) {
          throw new BadRequestException(
            'This verification link has already been used',
          );
        }
        // Only if the account still has this exact email and is a live
        // (non-anonymised) account.
        const [updated] = await conn.query<ResultSetHeader>(
          `UPDATE customer SET verifiedEmail = email, emailVerifiedAt = ?
            WHERE id = ? AND passwordHash IS NOT NULL AND email = ?`,
          [new Date(), stored.customerId, stored.targetEmail],
        );
        if (updated.affectedRows === 0) throw invalid();
        await conn.query(
          `UPDATE customerauthtoken SET usedAt = ? WHERE customerId = ? AND purpose = 'password_reset' AND usedAt IS NULL`,
          [new Date(), stored.customerId],
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Another account in this shop already proved this address.
        throw new ConflictException(
          'This email address is already verified on another account',
        );
      }
      throw error;
    }
    return { success: true };
  }
}
