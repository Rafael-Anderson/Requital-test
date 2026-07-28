import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma, user as UserModel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import { sendEmail } from '../common/email';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_LIFETIME = '15m';
const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_DAYS = 30;
const RESET_TOKEN_LIFETIME_MINUTES = 30;
const VERIFICATION_TOKEN_LIFETIME_HOURS = 24;
const INVITE_TOKEN_LIFETIME_DAYS = 7;
// Where signup/forgot-password/verify-email links point — the admin app,
// not this API. No equivalent to storefront's STOREFRONT_URL existed yet
// since nothing before this generated a link into the admin frontend.
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
// Dev-only escape hatch: with no real email-sending infrastructure wired up
// yet (see common/email.ts), the actual link is only ever visible in the
// stubbed console log — echoing it back in the API response too keeps the
// reset/verify flow testable end-to-end without inbox access. Never do this
// in production: it would let anyone reset anyone else's password by just
// knowing their email address.
const isDev = process.env.NODE_ENV !== 'production';

const SHOP_NAME_SELECT = { shop: { select: { name: true } } } as const;
type UserWithRelations = UserModel & {
  outlet?: { id: number; name: string } | null;
  shop?: { name: string };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async signup(dto: SignupDto) {
    const existingSubdomain = await this.prisma.shop.findUnique({
      where: { subdomain: dto.subdomain },
    });
    if (existingSubdomain) {
      throw new ConflictException('This subdomain is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let user: UserWithRelations;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const shop = await tx.shop.create({
          data: { name: dto.shopName, subdomain: dto.subdomain },
        });
        // Every shop starts with one outlet so orders/inventory (both
        // outlet-scoped) are usable immediately after signup, without
        // forcing the merchant through outlet setup first.
        await tx.outlet.create({
          data: { shopId: shop.id, name: 'Main Branch' },
        });
        return tx.user.create({
          data: {
            shopId: shop.id,
            name: dto.name,
            email: dto.email,
            passwordHash,
            role: 'admin',
          },
          include: SHOP_NAME_SELECT,
        });
      });
    } catch (error) {
      this.handleUserCreateError(error);
    }

    const devVerificationLink = await this.sendVerificationEmail(user);
    return { ...(await this.issueTokenPair(user)), ...(devVerificationLink ? { devVerificationLink } : {}) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: SHOP_NAME_SELECT,
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.auditLogService.log(
      { shopId: user.shopId, actorUserId: user.id },
      { action: 'auth.login', entityType: 'auth', entityId: user.id },
    );
    return this.issueTokenPair(user);
  }

  // New access+refresh pair for the same session family — the presented
  // refresh token is consumed (rotated) in the same operation, never left
  // valid for a second use. See the CAS comment below for why a second
  // presentation of the same token — genuine theft or two requests racing
  // the same token — is treated identically.
  async refresh(dto: RefreshTokenDto) {
    const tokenHash = hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshtoken.findUnique({ where: { tokenHash } });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // CAS, same pattern as the order-status transition in orders.service.ts:
    // the WHERE re-checks revokedAt at the moment this UPDATE takes its row
    // lock, so only one caller can ever "win" rotating a given token even
    // under concurrency.
    const claimed = await this.prisma.refreshtoken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Lost the race, or this token was already rotated earlier — either
      // way, someone is presenting a token that's no longer the live edge
      // of this session's chain. Kill the whole family rather than just
      // this token: a stolen-then-reused token must not be able to keep
      // refreshing from wherever it branched off.
      await this.prisma.refreshtoken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions revoked, please log in again',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: SHOP_NAME_SELECT,
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.issueTokenPair(user, stored.familyId);
  }

  // Revokes the whole session family the presented token belongs to (one
  // login = one family, refreshed many times) — not just that one token.
  // Idempotent and never reveals whether the token was valid, unknown, or
  // already revoked: logout always reports success.
  async logout(dto: RefreshTokenDto) {
    const stored = await this.prisma.refreshtoken.findUnique({
      where: { tokenHash: hashToken(dto.refreshToken) },
    });
    if (stored) {
      await this.prisma.refreshtoken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  async me(ctx: TenantContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      include: SHOP_NAME_SELECT,
    });
    return this.toUserResponse(user);
  }

  async createBranchUser(ctx: TenantContext, dto: CreateBranchUserDto) {
    const role = dto.role ?? 'branch';
    let outletId: number | null = null;
    if (role === 'branch') {
      const outlet = await this.prisma.outlet.findFirst({
        where: { id: dto.outletId, shopId: ctx.shopId },
      });
      if (!outlet) {
        throw new BadRequestException('Outlet does not belong to this shop');
      }
      outletId = outlet.id;
    }

    // No password supplied (the normal admin-UI path) — the account is
    // created locked with an unguessable random hash and can only become
    // usable via the emailed invite link (see acceptInvite below). A caller
    // that does supply a password (existing scripted/test callers) still
    // gets the old immediately-usable behavior, unchanged.
    const passwordHash = await bcrypt.hash(
      dto.password ?? randomUUID() + randomUUID(),
      BCRYPT_ROUNDS,
    );
    let user: UserWithRelations;
    try {
      user = await this.prisma.user.create({
        data: {
          shopId: ctx.shopId,
          outletId,
          name: dto.name,
          email: dto.email,
          passwordHash,
          role,
        },
        include: SHOP_NAME_SELECT,
      });
    } catch (error) {
      this.handleUserCreateError(error);
    }

    if (!dto.password) {
      const devInviteLink = await this.sendInviteEmail(user);
      return { ...this.toUserResponse(user), ...(devInviteLink ? { devInviteLink } : {}) };
    }
    const devVerificationLink = await this.sendVerificationEmail(user);
    return { ...this.toUserResponse(user), ...(devVerificationLink ? { devVerificationLink } : {}) };
  }

  // Staff member follows the emailed link and sets their own password —
  // also marks the account verified (clicking a link only they could have
  // received from their own inbox is itself a verification) and logs them
  // straight in, same as signup does.
  async acceptInvite(dto: AcceptInviteDto) {
    const stored = await this.prisma.authtoken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!stored || stored.purpose !== 'staff_invite' || stored.expiresAt < new Date()) {
      throw new BadRequestException('This invite link is invalid or has expired');
    }
    const claimed = await this.prisma.authtoken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This invite link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash, emailVerified: true },
      include: SHOP_NAME_SELECT,
    });
    return this.issueTokenPair(user);
  }

  async listUsers(ctx: TenantContext) {
    const users = await this.prisma.user.findMany({
      where: { shopId: ctx.shopId },
      include: {
        outlet: { select: { id: true, name: true } },
        ...SHOP_NAME_SELECT,
      },
      orderBy: { id: 'asc' },
    });
    return users.map((u) => this.toUserResponse(u));
  }

  async changePassword(ctx: TenantContext, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
    });
    if (!user.emailVerified) {
      throw new ForbiddenException('Verify your email before changing your password');
    }
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: ctx.userId }, data: { passwordHash } }),
      // A changed password should end every other session too, not just
      // require re-login on this one device eventually.
      this.prisma.refreshtoken.updateMany({
        where: { userId: ctx.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Same response shape whether or not the email exists — don't let this
    // endpoint be used to enumerate registered accounts.
    if (!user) {
      return { success: true };
    }

    const raw = generateOpaqueToken();
    await this.prisma.authtoken.create({
      data: {
        userId: user.id,
        purpose: 'password_reset',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000),
      },
    });
    const resetLink = `${ADMIN_URL}/reset-password?token=${raw}`;
    await sendEmail(
      user.email,
      'Reset your Requital password',
      `Reset your password: ${resetLink}\nThis link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
    );
    return { success: true, ...(isDev ? { devResetLink: resetLink } : {}) };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const stored = await this.prisma.authtoken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!stored || stored.purpose !== 'password_reset' || stored.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
    // CAS on usedAt — a single-use token claimed exactly once even if the
    // reset form is somehow submitted twice concurrently.
    const claimed = await this.prisma.authtoken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This reset link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      this.prisma.refreshtoken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const stored = await this.prisma.authtoken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!stored || stored.purpose !== 'email_verification' || stored.expiresAt < new Date()) {
      throw new BadRequestException('This verification link is invalid or has expired');
    }
    const claimed = await this.prisma.authtoken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('This verification link has already been used');
    }
    await this.prisma.user.update({ where: { id: stored.userId }, data: { emailVerified: true } });
    return { success: true };
  }

  async resendVerification(ctx: TenantContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (user.emailVerified) {
      return { success: true, alreadyVerified: true as const };
    }
    const devVerificationLink = await this.sendVerificationEmail(user);
    return {
      success: true,
      alreadyVerified: false as const,
      ...(devVerificationLink ? { devVerificationLink } : {}),
    };
  }

  private async issueTokenPair(user: UserWithRelations, familyId?: string) {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, typ: 'staff' },
      { expiresIn: ACCESS_TOKEN_LIFETIME },
    );
    const rawRefreshToken = generateOpaqueToken();
    await this.prisma.refreshtoken.create({
      data: {
        userId: user.id,
        familyId: familyId ?? randomUUID(),
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return {
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      refreshToken: rawRefreshToken,
      user: this.toUserResponse(user),
    };
  }

  private async sendVerificationEmail(user: { id: number; email: string }): Promise<string | undefined> {
    const raw = generateOpaqueToken();
    await this.prisma.authtoken.create({
      data: {
        userId: user.id,
        purpose: 'email_verification',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_LIFETIME_HOURS * 60 * 60 * 1000),
      },
    });
    const link = `${ADMIN_URL}/verify-email?token=${raw}`;
    await sendEmail(user.email, 'Verify your Requital email', `Verify your email: ${link}`);
    return isDev ? link : undefined;
  }

  private async sendInviteEmail(user: { id: number; email: string }): Promise<string | undefined> {
    const raw = generateOpaqueToken();
    await this.prisma.authtoken.create({
      data: {
        userId: user.id,
        purpose: 'staff_invite',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + INVITE_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    const link = `${ADMIN_URL}/accept-invite?token=${raw}`;
    await sendEmail(
      user.email,
      "You've been invited to a Requital staff account",
      `Set your password to activate your account: ${link}\nThis link expires in ${INVITE_TOKEN_LIFETIME_DAYS} days.`,
    );
    return isDev ? link : undefined;
  }

  private toUserResponse(user: UserWithRelations) {
    const {
      id,
      shopId,
      outletId,
      name,
      email,
      role,
      emailVerified,
      createdAt,
      outlet,
      shop,
    } = user;
    return {
      id,
      shopId,
      outletId,
      name,
      email,
      role,
      emailVerified,
      createdAt,
      outlet,
      shopName: shop?.name,
    };
  }

  private handleUserCreateError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A user with this email already exists');
    }
    throw error;
  }
}
