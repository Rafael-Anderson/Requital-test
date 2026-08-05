import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import type { TenantContext, UserRole } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_LIFETIME = '15m';
const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;
const REFRESH_TOKEN_LIFETIME_DAYS = 30;
const RESET_TOKEN_LIFETIME_MINUTES = 30;
const VERIFICATION_TOKEN_LIFETIME_HOURS = 24;
const INVITE_TOKEN_LIFETIME_DAYS = 7;
// Progressive login delay, not a hard lockout — see login()'s own comment
// for the reasoning. No friction for the first few genuine typos; only
// consecutive failures at/above this count start requiring a wait.
const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_BASE_DELAY_SECONDS = 2;
const LOGIN_LOCKOUT_MAX_DELAY_SECONDS = 60;
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
          data: {
            name: dto.shopName,
            subdomain: dto.subdomain,
            businessType: dto.businessType,
            trn: dto.trn,
            websiteUrl: dto.websiteUrl,
            address: dto.address,
            operatingModel: dto.operatingModel?.join(','),
            branchCount: dto.branchCount,
            productEditorMode: dto.productEditorMode,
          },
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
            phone: dto.phone,
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
    return {
      ...(await this.issueTokenPair(user)),
      ...(devVerificationLink ? { devVerificationLink } : {}),
    };
  }

  // Per-IP brute-force protection is the ThrottlerGuard on this endpoint
  // (5/min/IP, see auth.controller.ts) — this is the complementary
  // per-account layer, since a distributed attacker spread across many IPs
  // is invisible to per-IP throttling. Deliberately a *progressive delay*,
  // not a hard lockout: a real account can never be denied service by
  // someone who merely knows its email and guesses wrong — the correct
  // password always succeeds immediately once the (capped) delay since the
  // last failure has elapsed, and the counter resets to 0 on success. A true
  // lockedUntil-style lockout would let an attacker who knows a merchant's
  // email address indefinitely deny them access to their own shop, which is
  // a worse outcome than the brute-force risk it would prevent.
  //
  // The response is identical (401 "Invalid email or password") whether the
  // email doesn't exist, the password is wrong, or the account is within its
  // cooldown window — bcrypt.compare is skipped in the cooldown case (same
  // as the already-existing no-such-user fast path), so this doesn't add a
  // new distinguishable timing/response class beyond what already existed.
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: SHOP_NAME_SELECT,
    });

    if (user && this.isWithinLoginCooldown(user)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      if (user) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: { increment: 1 },
            lastFailedLoginAt: new Date(),
          },
        });
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.failedLoginAttempts > 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lastFailedLoginAt: null },
      });
    }
    await this.auditLogService.log(
      { shopId: user.shopId, actorUserId: user.id },
      { action: 'auth.login', entityType: 'auth', entityId: user.id },
    );
    return this.issueTokenPair(user);
  }

  private isWithinLoginCooldown(user: {
    failedLoginAttempts: number;
    lastFailedLoginAt: Date | null;
  }): boolean {
    if (
      user.failedLoginAttempts < LOGIN_LOCKOUT_THRESHOLD ||
      !user.lastFailedLoginAt
    ) {
      return false;
    }
    const delaySeconds = Math.min(
      LOGIN_LOCKOUT_MAX_DELAY_SECONDS,
      LOGIN_LOCKOUT_BASE_DELAY_SECONDS **
        (user.failedLoginAttempts - LOGIN_LOCKOUT_THRESHOLD + 1),
    );
    const elapsedMs = Date.now() - user.lastFailedLoginAt.getTime();
    return elapsedMs < delaySeconds * 1000;
  }

  // New access+refresh pair for the same session family — the presented
  // refresh token is consumed (rotated) in the same operation, never left
  // valid for a second use. See the CAS comment below for why a second
  // presentation of the same token — genuine theft or two requests racing
  // the same token — is treated identically.
  async refresh(dto: RefreshTokenDto) {
    const tokenHash = hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshtoken.findUnique({
      where: { tokenHash },
    });
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
      return {
        ...this.toUserResponse(user),
        ...(devInviteLink ? { devInviteLink } : {}),
      };
    }
    const devVerificationLink = await this.sendVerificationEmail(user);
    return {
      ...this.toUserResponse(user),
      ...(devVerificationLink ? { devVerificationLink } : {}),
    };
  }

  // Staff member follows the emailed link and sets their own password —
  // also marks the account verified (clicking a link only they could have
  // received from their own inbox is itself a verification) and logs them
  // straight in, same as signup does.
  async acceptInvite(dto: AcceptInviteDto) {
    const stored = await this.prisma.authtoken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (
      !stored ||
      stored.purpose !== 'staff_invite' ||
      stored.expiresAt < new Date()
    ) {
      throw new BadRequestException(
        'This invite link is invalid or has expired',
      );
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

  // The first place an existing staff member's role/outlet becomes
  // editable at all — until now, /auth/branch-users only ever supported
  // create. Self-edit is deliberately refused: use profile settings
  // (changePassword/me) instead, which also sidesteps an admin locking
  // themselves out of their own account through this endpoint.
  async updateStaffUser(
    ctx: TenantContext,
    id: number,
    dto: UpdateStaffUserDto,
  ) {
    if (id === ctx.userId) {
      throw new BadRequestException(
        'Use your profile settings to change your own account',
      );
    }
    const existing = await this.prisma.user.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const effectiveRole: UserRole = dto.role ?? (existing.role as UserRole);
    if (existing.role === 'admin' && effectiveRole !== 'admin') {
      await this.assertNotLastAdmin(ctx, id);
    }

    // Same outlet-required-for-branch-only rule as createBranchUser: an
    // outletId carried over from the existing row (if this request doesn't
    // touch role/outletId) is re-validated too, not just a fresh one.
    let outletId: number | null = null;
    if (effectiveRole === 'branch') {
      const requestedOutletId = dto.outletId ?? existing.outletId ?? undefined;
      const outlet = requestedOutletId
        ? await this.prisma.outlet.findFirst({
            where: { id: requestedOutletId, shopId: ctx.shopId },
          })
        : null;
      if (!outlet) {
        throw new BadRequestException(
          'A valid outletId is required for the branch role',
        );
      }
      outletId = outlet.id;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
        outletId,
      },
      include: SHOP_NAME_SELECT,
    });
    return this.toUserResponse(user);
  }

  // Historical records (audit log, order notes, returns, stock movements,
  // scan batches) reference this user's id without ON DELETE CASCADE —
  // deliberately, so a staff departure never silently rewrites who did
  // what. Pre-checking here turns that into a clear, actionable error
  // instead of a raw FK constraint failure surfacing from Prisma.
  async deleteStaffUser(ctx: TenantContext, id: number) {
    if (id === ctx.userId) {
      throw new BadRequestException(
        'Use your profile settings to manage your own account',
      );
    }
    const existing = await this.prisma.user.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }
    if (existing.role === 'admin') {
      await this.assertNotLastAdmin(ctx, id);
    }

    const [notes, logs, batches, movements, returns] =
      await this.prisma.$transaction([
        this.prisma.ordernote.count({ where: { authorUserId: id } }),
        this.prisma.auditlog.count({ where: { actorUserId: id } }),
        this.prisma.scanbatch.count({ where: { actorUserId: id } }),
        this.prisma.stockmovement.count({ where: { actorUserId: id } }),
        this.prisma.orderreturn.count({ where: { staffUserId: id } }),
      ]);
    if (notes + logs + batches + movements + returns > 0) {
      throw new ConflictException(
        'Cannot delete this account: it has existing activity history (notes, audit log, stock movements, or returns). Reassign is not currently supported.',
      );
    }

    await this.prisma.user.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async assertNotLastAdmin(
    ctx: TenantContext,
    excludingUserId: number,
  ) {
    const otherAdminCount = await this.prisma.user.count({
      where: {
        shopId: ctx.shopId,
        role: 'admin',
        id: { not: excludingUserId },
      },
    });
    if (otherAdminCount === 0) {
      throw new BadRequestException(
        "Cannot remove the shop's only remaining admin",
      );
    }
  }

  async changePassword(ctx: TenantContext, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
    });
    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Verify your email before changing your password',
      );
    }
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: ctx.userId },
        data: { passwordHash },
      }),
      // A changed password should end every other session too, not just
      // require re-login on this one device eventually.
      this.prisma.refreshtoken.updateMany({
        where: { userId: ctx.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // A password-reset link issued before this change (e.g. an old email
      // still sitting in an inbox) must not still be redeemable afterward —
      // the password it would "reset" no longer matches what the user
      // thinks their account's state is.
      this.prisma.authtoken.updateMany({
        where: { userId: ctx.userId, purpose: 'password_reset', usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Same response shape whether or not the email exists — don't let this
    // endpoint be used to enumerate registered accounts.
    if (!user) {
      return { success: true };
    }

    // A new request supersedes any still-outstanding one — otherwise
    // multiple valid reset links for the same account could be alive at
    // once (e.g. an old, forgotten email sitting in an inbox next to a
    // freshly requested one).
    await this.invalidateOutstandingTokens(user.id, 'password_reset');

    const raw = generateOpaqueToken();
    await this.prisma.authtoken.create({
      data: {
        userId: user.id,
        purpose: 'password_reset',
        tokenHash: hashToken(raw),
        expiresAt: new Date(
          Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000,
        ),
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
    if (
      !stored ||
      stored.purpose !== 'password_reset' ||
      stored.expiresAt < new Date()
    ) {
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
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
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.refreshtoken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // Defense in depth alongside forgotPassword's own supersession call —
      // any other reset token for this user (there normally shouldn't be
      // one, but a race between two forgot-password requests could leave a
      // second live one) dies the moment the password actually changes.
      this.prisma.authtoken.updateMany({
        where: {
          userId: stored.userId,
          purpose: 'password_reset',
          usedAt: null,
        },
        data: { usedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const stored = await this.prisma.authtoken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (
      !stored ||
      stored.purpose !== 'email_verification' ||
      stored.expiresAt < new Date()
    ) {
      throw new BadRequestException(
        'This verification link is invalid or has expired',
      );
    }
    const claimed = await this.prisma.authtoken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(
        'This verification link has already been used',
      );
    }
    await this.prisma.user.update({
      where: { id: stored.userId },
      data: { emailVerified: true },
    });
    return { success: true };
  }

  async resendVerification(ctx: TenantContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
    });
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
        expiresAt: new Date(
          Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    });
    return {
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      refreshToken: rawRefreshToken,
      user: this.toUserResponse(user),
    };
  }

  // Marks every still-live (unused, regardless of expiry) token of the given
  // purpose as used, so an old link can never be redeemed after a newer one
  // superseded it. Reuses the same `usedAt` CAS field single-use redemption
  // already relies on — "invalidated" and "already used" are the same state
  // from resetPassword/verifyEmail's point of view, so no new column/status
  // is needed to represent it.
  private async invalidateOutstandingTokens(
    userId: number,
    purpose: 'password_reset' | 'email_verification',
  ) {
    await this.prisma.authtoken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  private async sendVerificationEmail(user: {
    id: number;
    email: string;
  }): Promise<string | undefined> {
    // Same supersession rule as forgotPassword above — a resend must kill
    // any still-outstanding verification token rather than leaving multiple
    // valid links alive at once. A no-op on the signup call site (nothing to
    // invalidate yet).
    await this.invalidateOutstandingTokens(user.id, 'email_verification');

    const raw = generateOpaqueToken();
    await this.prisma.authtoken.create({
      data: {
        userId: user.id,
        purpose: 'email_verification',
        tokenHash: hashToken(raw),
        expiresAt: new Date(
          Date.now() + VERIFICATION_TOKEN_LIFETIME_HOURS * 60 * 60 * 1000,
        ),
      },
    });
    const link = `${ADMIN_URL}/verify-email?token=${raw}`;
    await sendEmail(
      user.email,
      'Verify your Requital email',
      `Verify your email: ${link}`,
    );
    return isDev ? link : undefined;
  }

  private async sendInviteEmail(user: {
    id: number;
    email: string;
  }): Promise<string | undefined> {
    const raw = generateOpaqueToken();
    await this.prisma.authtoken.create({
      data: {
        userId: user.id,
        purpose: 'staff_invite',
        tokenHash: hashToken(raw),
        expiresAt: new Date(
          Date.now() + INVITE_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
        ),
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
