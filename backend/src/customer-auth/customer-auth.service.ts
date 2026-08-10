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
import type { RowDataPacket } from 'mysql2/promise';
import type { CustomerRow, ShopRow } from '../db/types';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import { JobsService } from '../jobs/jobs.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { RefreshCustomerTokenDto } from './dto/refresh-customer-token.dto';
import { ForgotCustomerPasswordDto } from './dto/forgot-customer-password.dto';
import { ResetCustomerPasswordDto } from './dto/reset-customer-password.dto';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_LIFETIME = '15m';
const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_DAYS = 30;
const RESET_TOKEN_LIFETIME_MINUTES = 30;
// Progressive login delay — mirrors AuthService's own constants exactly
// (see that file's login()/isWithinLoginCooldown() comments for the full
// reasoning). Duplicated rather than shared: this module is already a
// deliberately fully-separate stack from staff auth (own tokens, own
// guard, own rotation — see this file's own top-of-module convention), so
// a shared lockout helper would couple two modules the codebase keeps
// independent on purpose. The two constants sets are kept in sync by hand.
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_BASE_DELAY_SECONDS = 2;
const LOGIN_LOCKOUT_MAX_DELAY_SECONDS = 60;
// Where the reset link points — the storefront app, not this API. Same
// pattern as AuthService's ADMIN_URL, just the other frontend.
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';
// Same dev-only echo-the-link-back convenience as AuthService — see its
// comment for why this must never happen in production.
const isDev = process.env.NODE_ENV !== 'production';

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly jobsService: JobsService,
  ) {}

  // "Register" is "claim" — find the [shopId, phone] row guest checkout
  // would also match (see CustomersService.findOrCreateForOrder, the exact
  // same key) and set a password on it, rather than creating a second
  // linked entity. A row with no prior order history simply doesn't exist
  // yet and is created fresh with the password already set.
  async register(shopSlug: string, dto: RegisterCustomerDto) {
    const shop = await this.resolveShop(shopSlug);

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

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let customerId: number;
    if (existing) {
      await this.db.execute(
        `UPDATE customer SET passwordHash = ?, registeredAt = ?, name = ?, email = ? WHERE id = ?`,
        [
          passwordHash,
          new Date(),
          // A guest checkout's captured name/email might be stale or
          // absent by the time they register — the name/email given at
          // registration wins.
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

    const customer = await this.findCustomerByIdOrThrow(customerId);
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
      `SELECT * FROM customer WHERE shopId = ? AND (phone = ? OR email = ?)`,
      [shop.id, dto.identifier, dto.identifier],
    );
    const customer = rows[0];

    if (customer?.passwordHash && this.isWithinLoginCooldown(customer)) {
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

  private isWithinLoginCooldown(customer: {
    failedLoginAttempts: number;
    lastFailedLoginAt: Date | null;
  }): boolean {
    if (
      customer.failedLoginAttempts < LOGIN_LOCKOUT_THRESHOLD ||
      !customer.lastFailedLoginAt
    ) {
      return false;
    }
    const delaySeconds = Math.min(
      LOGIN_LOCKOUT_MAX_DELAY_SECONDS,
      LOGIN_LOCKOUT_BASE_DELAY_SECONDS **
        (customer.failedLoginAttempts - LOGIN_LOCKOUT_THRESHOLD + 1),
    );
    const elapsedMs = Date.now() - customer.lastFailedLoginAt.getTime();
    return elapsedMs < delaySeconds * 1000;
  }

  async refresh(shopSlug: string, dto: RefreshCustomerTokenDto) {
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
        'Refresh token reuse detected — all sessions revoked, please log in again',
      );
    }

    const customer = await this.findCustomerById(stored.customerId as number);
    if (!customer?.passwordHash || customer.shopId !== shop.id) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.issueTokenPair(customer, stored.familyId as string);
  }

  async logout(dto: RefreshCustomerTokenDto) {
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

  // Email-based, reusing the exact same opaque-token + hash-at-rest +
  // single-use-CAS pattern as AuthService.forgotPassword/resetPassword —
  // this generalizes cleanly since it's shop-scoped the same way everything
  // else here is. What does NOT generalize: a customer who registered with
  // phone only (email is optional at registration, matching checkout) has
  // no email on file and therefore no way to receive a reset link — this
  // method still returns {success:true} for them (same
  // don't-leak-whether-an-account-exists reasoning as the email-not-found
  // case) but no email is ever sent. There's no in-app "reset via phone"
  // path today; flagging this as a real gap for phone-only accounts rather
  // than building an SMS-OTP flow that wasn't asked for.
  async forgotPassword(shopSlug: string, dto: ForgotCustomerPasswordDto) {
    const shop = await this.resolveShop(shopSlug);
    const rows = await this.db.query<(CustomerRow & RowDataPacket)[]>(
      `SELECT * FROM customer WHERE shopId = ? AND email = ? AND passwordHash IS NOT NULL`,
      [shop.id, dto.email],
    );
    const customer = rows[0];
    if (!customer) {
      return { success: true };
    }

    const raw = generateOpaqueToken();
    await this.db.execute(
      `INSERT INTO customerauthtoken (customerId, purpose, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        customer.id,
        'password_reset',
        hashToken(raw),
        new Date(Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000),
      ],
    );
    const resetLink = `${STOREFRONT_URL}/${shopSlug}/account/reset-password?token=${raw}`;
    await this.jobsService.enqueue(
      shop.id,
      'send_email',
      {
        to: customer.email!,
        subject: 'Reset your password',
        bodyText: `Reset your password: ${resetLink}\nThis link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
        fromName: shop.displayName ?? shop.name,
      },
      `customer-password-reset-email:${customer.id}:${raw}`,
    );
    return { success: true, ...(isDev ? { devResetLink: resetLink } : {}) };
  }

  async resetPassword(dto: ResetCustomerPasswordDto) {
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
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    }
    const claimed = await this.db.execute(
      `UPDATE customerauthtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      throw new BadRequestException('This reset link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const customerId = stored.customerId as number;
    await this.db.transaction(async (conn) => {
      await conn.query(`UPDATE customer SET passwordHash = ? WHERE id = ?`, [
        passwordHash,
        customerId,
      ]);
      await conn.query(
        `UPDATE customerrefreshtoken SET revokedAt = ? WHERE customerId = ? AND revokedAt IS NULL`,
        [new Date(), customerId],
      );
    });
    return { success: true };
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
      emailVerified,
      registeredAt,
      createdAt,
    } = customer;
    return {
      id,
      shopId,
      name,
      phone,
      email,
      emailVerified,
      registeredAt,
      createdAt,
    };
  }
}
