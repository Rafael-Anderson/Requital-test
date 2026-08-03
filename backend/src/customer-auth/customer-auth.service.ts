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
import { customer as CustomerModel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import { sendEmail } from '../common/email';
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
// Where the reset link points — the storefront app, not this API. Same
// pattern as AuthService's ADMIN_URL, just the other frontend.
const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';
// Same dev-only echo-the-link-back convenience as AuthService — see its
// comment for why this must never happen in production.
const isDev = process.env.NODE_ENV !== 'production';

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
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
      const emailTaken = await this.prisma.customer.findFirst({
        where: {
          shopId: shop.id,
          email: dto.email,
          passwordHash: { not: null },
        },
      });
      if (emailTaken) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
    }

    const existing = await this.prisma.customer.findUnique({
      where: { shopId_phone: { shopId: shop.id, phone: dto.phone } },
    });
    if (existing?.passwordHash) {
      throw new ConflictException(
        'An account with this phone number already exists',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const customer = existing
      ? await this.prisma.customer.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            registeredAt: new Date(),
            // A guest checkout's captured name/email might be stale or
            // absent by the time they register — the name/email given at
            // registration wins.
            name: dto.name,
            email: dto.email ?? existing.email,
          },
        })
      : await this.prisma.customer.create({
          data: {
            shopId: shop.id,
            name: dto.name,
            phone: dto.phone,
            email: dto.email,
            passwordHash,
            registeredAt: new Date(),
          },
        });

    return this.issueTokenPair(customer);
  }

  async login(shopSlug: string, dto: LoginCustomerDto) {
    const shop = await this.resolveShop(shopSlug);
    const customer = await this.prisma.customer.findFirst({
      where: {
        shopId: shop.id,
        OR: [{ phone: dto.identifier }, { email: dto.identifier }],
      },
    });
    if (
      !customer?.passwordHash ||
      !(await bcrypt.compare(dto.password, customer.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid phone/email or password');
    }
    return this.issueTokenPair(customer);
  }

  async refresh(shopSlug: string, dto: RefreshCustomerTokenDto) {
    const shop = await this.resolveShop(shopSlug);
    const tokenHash = hashToken(dto.refreshToken);
    const stored = await this.prisma.customerrefreshtoken.findUnique({
      where: { tokenHash },
    });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Same rotate-via-CAS + kill-the-family-on-reuse pattern as
    // AuthService.refresh — see its comment for the full reasoning.
    const claimed = await this.prisma.customerrefreshtoken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.prisma.customerrefreshtoken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions revoked, please log in again',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: stored.customerId },
    });
    if (!customer?.passwordHash || customer.shopId !== shop.id) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.issueTokenPair(customer, stored.familyId);
  }

  async logout(dto: RefreshCustomerTokenDto) {
    const stored = await this.prisma.customerrefreshtoken.findUnique({
      where: { tokenHash: hashToken(dto.refreshToken) },
    });
    if (stored) {
      await this.prisma.customerrefreshtoken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
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
    const customer = await this.prisma.customer.findFirst({
      where: { shopId: shop.id, email: dto.email, passwordHash: { not: null } },
    });
    if (!customer) {
      return { success: true };
    }

    const raw = generateOpaqueToken();
    await this.prisma.customerauthtoken.create({
      data: {
        customerId: customer.id,
        purpose: 'password_reset',
        tokenHash: hashToken(raw),
        expiresAt: new Date(
          Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000,
        ),
      },
    });
    const resetLink = `${STOREFRONT_URL}/${shopSlug}/account/reset-password?token=${raw}`;
    await sendEmail(
      customer.email!,
      'Reset your password',
      `Reset your password: ${resetLink}\nThis link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
      { fromName: shop.displayName ?? shop.name },
    );
    return { success: true, ...(isDev ? { devResetLink: resetLink } : {}) };
  }

  async resetPassword(dto: ResetCustomerPasswordDto) {
    const stored = await this.prisma.customerauthtoken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (
      !stored ||
      stored.purpose !== 'password_reset' ||
      stored.expiresAt < new Date()
    ) {
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    }
    const claimed = await this.prisma.customerauthtoken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This reset link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: stored.customerId },
        data: { passwordHash },
      }),
      this.prisma.customerrefreshtoken.updateMany({
        where: { customerId: stored.customerId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  private async resolveShop(shopSlug: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { subdomain: shopSlug },
    });
    if (!shop) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }
    return shop;
  }

  private async issueTokenPair(customer: CustomerModel, familyId?: string) {
    const accessToken = await this.jwtService.signAsync(
      { sub: customer.id, typ: 'customer' },
      { expiresIn: ACCESS_TOKEN_LIFETIME },
    );
    const rawRefreshToken = generateOpaqueToken();
    await this.prisma.customerrefreshtoken.create({
      data: {
        customerId: customer.id,
        familyId: familyId ?? randomUUID(),
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: new Date(
          Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });
    return {
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      refreshToken: rawRefreshToken,
      customer: this.toCustomerResponse(customer),
    };
  }

  private toCustomerResponse(customer: CustomerModel) {
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
