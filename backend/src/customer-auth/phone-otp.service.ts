import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { FeaturesService } from '../features/features.service';
import { isLockConflict } from '../database/mysql-errors';
import { normalizePhoneToE164 } from '../common/phone';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import type { PhoneotpRow, ShopRow } from '../db/types';
import { OTP_CHANNEL, type OtpChannel } from './otp-channel';
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  PHONE_PROOF_SHAPE,
  PROOF_TTL_MS,
  SEND_LIMITS,
  SHOP_DAILY_CAP_DEFAULT,
  generateOtpCode,
  hashOtpCode,
  phoneInShopCountry,
  safeEqualHex,
} from './phone-otp';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const PHONE_PROOF_REQUIRED = 'phone_verification_required';

// One answer for every reason a code does not verify (wrong, expired, used, too
// many tries, no code sent): nothing tells the caller which.
const invalidCode = () => new BadRequestException('Invalid or expired code');

@Injectable()
export class PhoneOtpService {
  constructor(
    private readonly db: DatabaseService,
    private readonly features: FeaturesService,
    @Inject(OTP_CHANNEL) private readonly channel: OtpChannel,
  ) {}

  // Platform kill switch. Read per call so flipping it needs no restart on the
  // env-reload path; it only ever stops SENDING (a login never touches this).
  private sendingDisabled(): boolean {
    return process.env.PHONE_OTP_DISABLED === '1';
  }

  private shopDailyCap(): number {
    const n = Number(process.env.PHONE_OTP_SHOP_DAILY_CAP);
    return Number.isInteger(n) && n > 0 ? n : SHOP_DAILY_CAP_DEFAULT;
  }

  private async resolveShop(shopSlug: string) {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ?`,
      [shopSlug],
    );
    const shop = rows[0];
    if (!shop) throw new NotFoundException('Not found');
    return shop;
  }

  // Same 404 a missing route gives, so a shop that has not enabled the feature
  // looks exactly like today.
  private async resolveEnabledShop(shopSlug: string) {
    const shop = await this.resolveShop(shopSlug);
    if (!(await this.features.isEnabled(shop.id, 'phone_otp_register'))) {
      throw new NotFoundException('Not found');
    }
    return shop;
  }

  async isRequired(shopId: number): Promise<boolean> {
    return this.features.isEnabled(shopId, 'phone_otp_register');
  }

  // Always the same answer to the caller (the controller returns a fixed 202
  // body): an unknown number, a registered one, a throttled one, a number in the
  // wrong country and a delivery failure are indistinguishable.
  async send(shopSlug: string, rawPhone: string): Promise<void> {
    const shop = await this.resolveEnabledShop(shopSlug);
    const phone = normalizePhoneToE164(rawPhone, shop.countryCode);
    if (
      !phone ||
      !phoneInShopCountry(phone, shop.countryCode) ||
      this.sendingDisabled()
    ) {
      return;
    }
    const code = generateOtpCode();
    const now = Date.now();

    // Housekeeping: rows older than the longest throttle window are dead weight.
    await this.db.execute(`DELETE FROM phoneotp WHERE createdAt < ? LIMIT 200`, [
      new Date(now - 2 * DAY),
    ]);

    let issued = false;
    try {
      issued = await this.db.transaction(async (conn) => {
        // Locks this phone's existing rows and the gap after them, so two
        // concurrent sends for one number serialise (a deadlock victim lands in
        // the catch below and simply sends nothing).
        const [recent] = await conn.query<RowDataPacket[]>(
          `SELECT createdAt FROM phoneotp
            WHERE shopId = ? AND phone = ? AND createdAt > ? FOR UPDATE`,
          [shop.id, phone, new Date(now - DAY)],
        );
        const since = (ms: number) =>
          recent.filter((r) => (r.createdAt as Date).getTime() > now - ms)
            .length;
        if (
          since(MIN) >= SEND_LIMITS.perMinute ||
          since(HOUR) >= SEND_LIMITS.perHour ||
          since(DAY) >= SEND_LIMITS.perDay
        ) {
          return false;
        }
        const [shopDay] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM phoneotp WHERE shopId = ? AND createdAt > ?`,
          [shop.id, new Date(now - DAY)],
        );
        if (Number(shopDay[0].n) >= this.shopDailyCap()) return false;

        // Only the newest code is live.
        await conn.query(
          `UPDATE phoneotp SET consumedAt = ? WHERE shopId = ? AND phone = ? AND consumedAt IS NULL`,
          [new Date(now), shop.id, phone],
        );
        await conn.query(
          `INSERT INTO phoneotp (shopId, phone, codeHash, expiresAt) VALUES (?, ?, ?, ?)`,
          [
            shop.id,
            phone,
            hashOtpCode(shop.id, phone, code),
            new Date(now + OTP_TTL_MS),
          ],
        );
        return true;
      });
    } catch (err) {
      if (!isLockConflict(err)) throw err;
    }
    if (!issued) return;
    // After the commit and outside it: a slow or failing provider holds no lock
    // or connection, and its failure must not change the answer.
    await this.channel.send(phone, code, { shopId: shop.id }).catch(() => undefined);
  }

  // Exchanges a correct code for a single-use proof token bound to this shop and
  // phone. The attempt is counted BEFORE the compare, in one statement, so
  // parallel guesses cannot exceed the cap; the consume is a compare-and-swap.
  async verify(shopSlug: string, rawPhone: string, code: string) {
    const shop = await this.resolveEnabledShop(shopSlug);
    const phone = normalizePhoneToE164(rawPhone, shop.countryCode);
    if (!phone) throw invalidCode();
    const rows = await this.db.query<(PhoneotpRow & RowDataPacket)[]>(
      `SELECT * FROM phoneotp
        WHERE shopId = ? AND phone = ? AND consumedAt IS NULL
        ORDER BY id DESC LIMIT 1`,
      [shop.id, phone],
    );
    const row = rows[0];
    if (!row) throw invalidCode();
    const counted = await this.db.execute(
      `UPDATE phoneotp SET attempts = attempts + 1
        WHERE id = ? AND shopId = ? AND consumedAt IS NULL AND expiresAt > ? AND attempts < ?`,
      [row.id, shop.id, new Date(), OTP_MAX_ATTEMPTS],
    );
    if (counted.affectedRows === 0) throw invalidCode();
    if (!safeEqualHex(hashOtpCode(shop.id, phone, code), row.codeHash)) {
      throw invalidCode();
    }
    const proof = generateOpaqueToken();
    const won = await this.db.execute(
      `UPDATE phoneotp SET consumedAt = ?, proofHash = ?, proofExpiresAt = ?
        WHERE id = ? AND shopId = ? AND consumedAt IS NULL`,
      [
        new Date(),
        hashToken(proof),
        new Date(Date.now() + PROOF_TTL_MS),
        row.id,
        shop.id,
      ],
    );
    if (won.affectedRows === 0) throw invalidCode();
    return { proof };
  }

  private proofRequired() {
    return new BadRequestException({
      statusCode: 400,
      message: 'Verify your phone number to continue',
      code: PHONE_PROOF_REQUIRED,
    });
  }

  // Non-consuming check, so a rejected password or an email conflict does not
  // burn the proof (same ordering as the password-reset token).
  async assertProofValid(
    shopId: number,
    phoneE164: string | null,
    proof: string | undefined,
  ): Promise<void> {
    if (!phoneE164 || !proof || !PHONE_PROOF_SHAPE.test(proof)) {
      throw this.proofRequired();
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM phoneotp
        WHERE shopId = ? AND phone = ? AND proofHash = ? AND proofUsedAt IS NULL AND proofExpiresAt > ?`,
      [shopId, phoneE164, hashToken(proof), new Date()],
    );
    if (rows.length === 0) throw this.proofRequired();
  }

  // Spends the proof. Scoped by shop AND phone, so a proof minted for another
  // shop or number never matches; the CAS makes it single use.
  async consumeProof(
    shopId: number,
    phoneE164: string | null,
    proof: string | undefined,
  ): Promise<void> {
    if (!phoneE164 || !proof || !PHONE_PROOF_SHAPE.test(proof)) {
      throw this.proofRequired();
    }
    const res: ResultSetHeader = await this.db.execute(
      `UPDATE phoneotp SET proofUsedAt = ?
        WHERE shopId = ? AND phone = ? AND proofHash = ? AND proofUsedAt IS NULL AND proofExpiresAt > ?`,
      [new Date(), shopId, phoneE164, hashToken(proof), new Date()],
    );
    if (res.affectedRows === 0) throw this.proofRequired();
  }
}
