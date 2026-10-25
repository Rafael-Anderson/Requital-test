import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { CustomerRow, ShopRow } from '../db/types';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import { JobsService } from '../jobs/jobs.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { ForgotCustomerPasswordDto } from './dto/forgot-customer-password.dto';
import { ResetCustomerPasswordDto } from './dto/reset-customer-password.dto';
import { storefrontUrl } from '../common/storefront-url';
import { PasswordPolicyService } from '../common/password-policy/password-policy.service';
import { CustomerEmailVerificationService } from './customer-email-verification.service';
import { renderCustomerLinkEmail } from './customer-link-email';
import { isWithinLoginCooldown } from './login-lockout';
import { isEmailVerified } from './email-verified';
import { PhoneOtpService } from './phone-otp.service';
import { normalizePhoneToE164 } from '../common/phone';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_LIFETIME = '15m';
const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_DAYS = 30;
const RESET_TOKEN_LIFETIME_MINUTES = 30;
// Where the reset link points — the storefront app, not this API. Same
// pattern as AuthService's ADMIN_URL, just the other frontend.
// Same dev-only echo-the-link-back convenience as AuthService — see its
// comment for why this must never happen in production.
const isDev = process.env.NODE_ENV !== 'production';

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly jobsService: JobsService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly emailVerification: CustomerEmailVerificationService,
    private readonly phoneOtp: PhoneOtpService,
  ) {}

  // "Register" is "claim" — find the [shopId, phone] row guest checkout
  // would also match (see CustomersService.findOrCreateForOrder, the exact
  // same key) and set a password on it, rather than creating a second
  // linked entity. A row with no prior order history simply doesn't exist
  // yet and is created fresh with the password already set.
  async register(shopSlug: string, dto: RegisterCustomerDto) {
    const shop = await this.resolveShop(shopSlug);

    // Phone OTP (flag per shop, off by default). When on, EVERY registration needs
    // a proof of control of this phone, not only the claim of a row with history:
    // a row created here for a number nobody proved would later be matched by that
    // person's guest checkout and hand their orders to this account. Checked first
    // so an unproven caller learns nothing from the conflicts below.
    const otpRequired = await this.phoneOtp.isRequired(shop.id);
    const proofPhone = otpRequired
      ? normalizePhoneToE164(dto.phone, shop.countryCode)
      : null;
    if (otpRequired) {
      await this.phoneOtp.assertProofValid(shop.id, proofPhone, dto.phoneProof);
    }

    if (dto.email) {
      // No DB-level unique constraint on (shopId, email) — see
      // schema.prisma's comment on `customer` — so this is an app-level
      // check, scoped to already-registered accounts only (two different
      // guest checkouts sharing an email is harmless and pre-existing;
      // login-by-email needs uniqueness only among *registered* rows).
      const emailTakenRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM customer WHERE shopId = ? AND email = ? AND passwordHash IS NOT NULL`,
        [shop.id, dto.email],
      );
      if (emailTakenRows.length > 0) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
    }

    const existingRows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE shopId = ? AND phone = ?`,
      [shop.id, dto.phone],
    );
    const existing = existingRows[0];
    if (existing?.passwordHash) {
      throw new ConflictException(
        'An account with this phone number already exists',
      );
    }

    await this.passwordPolicy.assertAcceptable(dto.password, {
      email: dto.email,
      name: dto.name,
      shopName: shop.name,
      subdomain: shop.subdomain,
      phone: dto.phone,
    });
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    if (otpRequired) {
      // Single use: the compare-and-swap decides between concurrent registers.
      await this.phoneOtp.consumeProof(shop.id, proofPhone, dto.phoneProof);
    }
    let customerId: number;
    if (existing) {
      await this.db.execute(
        `UPDATE customer SET passwordHash = ?, registeredAt = ?, name = ?, email = ?, verifiedEmail = NULL, emailVerifiedAt = NULL WHERE id = ?`,
        [
          passwordHash,
          new Date(),
          // A guest checkout's captured name/email might be stale or
          // absent by the time they register — the name/email given at
          // registration wins. The email is unproven either way (the
          // verified columns are cleared above: a claimed row never inherits
          // trust) until the link sent below is clicked.
          dto.name,
          dto.email ?? existing.email,
          existing.id,
        ],
      );
      customerId = existing.id;
    } else {
      const result = await this.db.execute(
        `INSERT INTO customer (shopId, name, phone, email, passwordHash, registeredAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [shop.id, dto.name, dto.phone, dto.email ?? null, passwordHash, new Date()],
      );
      customerId = result.insertId;
    }

    if (otpRequired) {
      await this.db.execute(
        `UPDATE customer SET phoneVerifiedAt = ? WHERE id = ? AND shopId = ?`,
        [new Date(), customerId, shop.id],
      );
    }
    const customer = await this.findCustomerByIdOrThrow(customerId);
    // A send problem must not fail the registration that already succeeded.
    await this.emailVerification
      .sendForCustomer(shop, customer)
      .catch(() => undefined);
    return this.issueTokenPair(customer);
  }

  // Per-account progressive login delay, mirroring AuthService.login's own
  // mechanism (see its comment for the full DoS-safety reasoning — it
  // applies identically here). A guest-only row (no passwordHash yet) is
  // never tracked: there's no valid credential to eventually succeed with,
  // so it's treated exactly like "no such account" always was, with no
  // counter to maintain.
  async login(shopSlug: string, dto: LoginCustomerDto) {
    const shop = await this.resolveShop(shopSlug);
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      // Registered accounts only, in a fixed order: a guest row that merely
      // carries someone's email (checkout stores whatever was typed) must not
      // shadow the real account, and when two registered rows could match, the
      // phone, then the proven email, wins.
      `SELECT * FROM customer
        WHERE shopId = ? AND passwordHash IS NOT NULL
          AND (phone = ? OR email = ? OR verifiedEmail = ?)
        ORDER BY (phone = ?) DESC, (verifiedEmail = ?) DESC, id ASC
        LIMIT 1`,
      [
        shop.id,
        dto.identifier,
        dto.identifier,
        dto.identifier,
        dto.identifier,
        dto.identifier,
      ],
    );
    const customer = rows[0];

    if (customer?.passwordHash && isWithinLoginCooldown(customer)) {
      throw new UnauthorizedException('Invalid phone/email or password');
    }

    if (
      !customer?.passwordHash ||
      !(await bcrypt.compare(dto.password, customer.passwordHash))
    ) {
      if (customer?.passwordHash) {
        await this.db.execute(
          `UPDATE customer SET failedLoginAttempts = failedLoginAttempts + 1, lastFailedLoginAt = ? WHERE id = ?`,
          [new Date(), customer.id],
        );
      }
      throw new UnauthorizedException('Invalid phone/email or password');
    }

    if (customer.failedLoginAttempts > 0) {
      await this.db.execute(
        `UPDATE customer SET failedLoginAttempts = 0, lastFailedLoginAt = NULL WHERE id = ?`,
        [customer.id],
      );
    }
    return this.issueTokenPair(customer);
  }

  async refresh(shopSlug: string, dto: { refreshToken: string }) {
    const shop = await this.resolveShop(shopSlug);
    const tokenHash = hashToken(dto.refreshToken);
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM customerrefreshtoken WHERE tokenHash = ?`,
      [tokenHash],
    );
    const stored = storedRows[0];
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if ((stored.expiresAt as Date) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Same rotate-via-CAS + kill-the-family-on-reuse pattern as
    // AuthService.refresh — see its comment for the full reasoning.
    const claimed = await this.db.execute(
      `UPDATE customerrefreshtoken SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      await this.db.execute(
        `UPDATE customerrefreshtoken SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL`,
        [new Date(), stored.familyId],
      );
      throw new UnauthorizedException(
        'Refresh token reuse detected. All sessions revoked, please log in again',
      );
    }

    const customer = await this.findCustomerById(stored.customerId as number);
    if (!customer?.passwordHash || customer.shopId !== shop.id) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.issueTokenPair(customer, stored.familyId as string);
  }

  async logout(dto: { refreshToken: string }) {
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT familyId FROM customerrefreshtoken WHERE tokenHash = ?`,
      [hashToken(dto.refreshToken)],
    );
    const stored = storedRows[0];
    if (stored) {
      await this.db.execute(
        `UPDATE customerrefreshtoken SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL`,
        [new Date(), stored.familyId],
      );
    }
    return { success: true };
  }

  // A reset link goes ONLY to an address the account owner proved by clicking a
  // verification link (customer.verifiedEmail). customer.email is whatever was
  // last typed (checkout, import, an old guest order) and proves nothing, so it
  // is never a destination. Unknown address, unverified address and verified
  // address all answer the same `{ success: true }` (the dev-only devResetLink
  // echo aside, which production never sends); nothing here reveals which one it
  // was. A phone-only or never-verified account has no reset path until it logs
  // in and verifies an address: there is no phone channel to fall back to.
  async forgotPassword(shopSlug: string, dto: ForgotCustomerPasswordDto) {
    const shop = await this.resolveShop(shopSlug);
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE shopId = ? AND verifiedEmail = ? AND passwordHash IS NOT NULL`,
      [shop.id, dto.email],
    );
    const customer = rows[0];
    if (!customer?.verifiedEmail) {
      return { success: true };
    }
    // One link a minute per account, so the endpoint cannot be used to flood a
    // customer's inbox; the answer is the same.
    const recent = await this.db.query<RowDataPacket[]>(
      `SELECT 1 FROM customerauthtoken WHERE customerId = ? AND purpose = 'password_reset' AND createdAt > ? LIMIT 1`,
      [customer.id, new Date(Date.now() - 60 * 1000)],
    );
    if (recent.length > 0) {
      return { success: true };
    }

    const raw = generateOpaqueToken();
    const inserted = await this.db.execute(
      `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt, targetEmail) VALUES (?, ?, ?, ?, ?)`,
      [
        customer.id,
        'password_reset',
        hashToken(raw),
        new Date(Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000),
        customer.verifiedEmail,
      ],
    );
    const resetLink = storefrontUrl(
      shop,
      `/account/reset-password?token=${raw}`,
    );
    const shopDisplayName = shop.displayName ?? shop.name;
    const resetHtml = renderCustomerLinkEmail({
      greetingName: customer.name,
      shopDisplayName,
      intro: `We received a request to reset your ${shopDisplayName} account password. This link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
      buttonLabel: 'Reset password',
      link: resetLink,
      ignoreNote: "If you didn't request a password reset, you can ignore this email.",
    });
    await this.jobsService.enqueue(
      shop.id,
      'send_email',
      {
        to: customer.verifiedEmail,
        subject: 'Reset your password',
        bodyText: `Reset your password: ${resetLink}\nThis link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
        html: resetHtml,
        fromName: shopDisplayName,
      },
      // The token row's id, not the raw token: the key is stored in clear.
      `customer-password-reset-email:${customer.id}:${inserted.insertId}`,
    );
    return { success: true, ...(isDev ? { devResetLink: resetLink } : {}) };
  }

  async resetPassword(dto: ResetCustomerPasswordDto) {
    const invalid = () =>
      new BadRequestException('This reset link is invalid or has expired');
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM customerauthtoken WHERE tokenHash = ?`,
      [hashToken(dto.token)],
    );
    const stored = storedRows[0];
    if (
      !stored ||
      stored.purpose !== 'password_reset' ||
      (stored.expiresAt as Date) < new Date()
    ) {
      throw invalid();
    }
    // Policy BEFORE the single-use claim, so a rejected weak password does
    // not burn the reset link.
    const custRows = await this.db.query<RowDataPacket[]>(
      `SELECT name, email, verifiedEmail, phone, shopId FROM customer WHERE id = ?`,
      [stored.customerId],
    );
    const cust = custRows[0];
    // The link is honoured only while the address it was sent to is still the
    // account's verified one. A link issued before verification existed has no
    // targetEmail and never passes; neither does one for an address that has
    // since been replaced.
    if (
      !cust ||
      !stored.targetEmail ||
      !cust.verifiedEmail ||
      String(stored.targetEmail).toLowerCase() !==
        String(cust.verifiedEmail).toLowerCase()
    ) {
      throw invalid();
    }
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT name, subdomain FROM shop WHERE id = ?`,
      [cust.shopId],
    );
    await this.passwordPolicy.assertAcceptable(dto.newPassword, {
      email: cust.email as string | null | undefined,
      name: cust.name as string | null | undefined,
      phone: cust.phone as string | null | undefined,
      shopName: shopRows[0]?.name as string | undefined,
      subdomain: shopRows[0]?.subdomain as string | undefined,
    });

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const customerId = stored.customerId as number;
    await this.db.transaction(async (conn) => {
      const [claimed] = await conn.query<ResultSetHeader>(
        `UPDATE customerauthtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
        [new Date(), stored.id],
      );
      if (claimed.affectedRows === 0) {
        throw new BadRequestException('This reset link has already been used');
      }
      // Re-checked in the write itself: the verified address must still be the
      // one the link was sent to, and the account must still be live (an
      // anonymised row has no password and must not get one back).
      const [updated] = await conn.query<ResultSetHeader>(
        `UPDATE customer SET passwordHash = ?
          WHERE id = ? AND verifiedEmail = ? AND passwordHash IS NOT NULL`,
        [passwordHash, customerId, stored.targetEmail],
      );
      if (updated.affectedRows === 0) throw invalid();
      await conn.query(
        `UPDATE customerrefreshtoken SET revokedAt = ? WHERE customerId = ? AND revokedAt IS NULL`,
        [new Date(), customerId],
      );
    });
    return { success: true };
  }

  verifyEmail(token: string) {
    return this.emailVerification.confirm(token);
  }

  private async resolveShop(shopSlug: string): Promise<ShopRow & RowDataPacket> {
    const rows = await this.db.query<(ShopRow & RowDataPacket)[]>(
      `SELECT * FROM shop WHERE subdomain = ?`,
      [shopSlug],
    );
    if (!rows[0]) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }
    return rows[0];
  }

  private async findCustomerById(
    id: number,
  ): Promise<(CustomerRow & RowDataPacket) | undefined> {
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private async findCustomerByIdOrThrow(id: number) {
    const customer = await this.findCustomerById(id);
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }

  private async issueTokenPair(
    customer: CustomerRow & { id: number },
    familyId?: string,
  ) {
    const accessToken = await this.jwtService.signAsync(
      { sub: customer.id, typ: 'customer' },
      { expiresIn: ACCESS_TOKEN_LIFETIME },
    );
    const rawRefreshToken = generateOpaqueToken();
    await this.db.execute(
      `INSERT INTO customerrefreshtoken (customerId, familyId, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        customer.id,
        familyId ?? randomUUID(),
        hashToken(rawRefreshToken),
        new Date(Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      ],
    );
    return {
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      refreshToken: rawRefreshToken,
      customer: this.toCustomerResponse(customer),
    };
  }

  private toCustomerResponse(customer: CustomerRow) {
    const {
      id,
      shopId,
      name,
      phone,
      email,
      verifiedEmail,
      registeredAt,
      createdAt,
    } = customer;
    return {
      id,
      shopId,
      name,
      phone,
      email,
      emailVerified: isEmailVerified({ email, verifiedEmail }),
      registeredAt,
      createdAt,
    };
  }
}
