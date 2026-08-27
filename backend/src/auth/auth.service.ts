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
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { buildSetClause } from '../database/update.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { UserRow } from '../db/types';
import { generateOpaqueToken, hashToken } from '../common/token-hash';
import { escapeHtml } from '../common/email';
import { JobsService } from '../jobs/jobs.service';
import { SignupDto } from './dto/signup.dto';
import { RESERVED_SUBDOMAINS } from '../shop/constants';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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
// See issueImpersonationTokenForShop's own comment for why this is shorter
// and non-refreshable, unlike a normal merchant session.
const IMPERSONATION_TOKEN_LIFETIME = '1h';
const IMPERSONATION_TOKEN_LIFETIME_SECONDS = 60 * 60;
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

type UserWithRelations = UserRow & {
  outlet?: { id: number; name: string } | null;
  shop?: { name: string; suspendedAt: Date | null };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly auditLogService: AuditLogService,
    private readonly jobsService: JobsService,
  ) {}

  async signup(dto: SignupDto) {
    if (RESERVED_SUBDOMAINS.includes(dto.subdomain)) {
      throw new BadRequestException('This subdomain is reserved');
    }
    const existingRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [dto.subdomain],
    );
    if (existingRows.length > 0) {
      throw new ConflictException('This subdomain is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let userId: number;
    try {
      userId = await this.db.transaction(async (conn) => {
        const [shopResult] = await conn.query(
          `INSERT INTO shop (name, subdomain, businessType, trn, websiteUrl, address, operatingModel, branchCount, productEditorMode, country)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            dto.shopName,
            dto.subdomain,
            dto.businessType ?? null,
            dto.trn ?? null,
            dto.websiteUrl ?? null,
            dto.address ?? null,
            dto.operatingModel?.join(',') ?? null,
            dto.branchCount ?? null,
            // Unlike its neighbors here, productEditorMode is NOT NULL (with
            // a DB default of 'simple') — a default only applies when a
            // column is omitted from the INSERT entirely, not when an
            // explicit NULL is passed, so this one needs its own fallback.
            dto.productEditorMode ?? 'simple',
            dto.country ?? null,
          ],
        );
        const shopId = (shopResult as { insertId: number }).insertId;
        // Every shop starts with one outlet so orders/inventory (both
        // outlet-scoped) are usable immediately after signup, without
        // forcing the merchant through outlet setup first.
        await conn.query(`INSERT INTO outlet (shopId, name) VALUES (?, ?)`, [
          shopId,
          'Main Branch',
        ]);
        const [userResult] = await conn.query(
          `INSERT INTO user (shopId, name, email, phone, passwordHash, role)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            shopId,
            dto.name,
            dto.email,
            dto.phone ?? null,
            passwordHash,
            'admin',
          ],
        );
        return (userResult as { insertId: number }).insertId;
      });
    } catch (error) {
      this.handleUserCreateError(error);
    }

    const user = await this.findByIdOrThrow(userId);
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
    const user = await this.findByEmail(dto.email);

    if (user && this.isWithinLoginCooldown(user)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      if (user) {
        await this.db.execute(
          `UPDATE user SET failedLoginAttempts = failedLoginAttempts + 1, lastFailedLoginAt = ? WHERE id = ?`,
          [new Date(), user.id],
        );
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    // Checked only after a correct password, deliberately — this is the
    // real "shop offline" enforcement point for merchant login (see
    // AuthGuard's matching per-request check for an already-issued token,
    // and PublicService.resolveShop for the storefront half).
    if (user.shop?.suspendedAt) {
      throw new ForbiddenException('This shop has been suspended');
    }

    if (user.failedLoginAttempts > 0) {
      await this.db.execute(
        `UPDATE user SET failedLoginAttempts = 0, lastFailedLoginAt = NULL WHERE id = ?`,
        [user.id],
      );
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
  async refresh(dto: { refreshToken: string }) {
    const tokenHash = hashToken(dto.refreshToken);
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM refreshtoken WHERE tokenHash = ?`,
      [tokenHash],
    );
    const stored = storedRows[0];
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if ((stored.expiresAt as Date) < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // CAS, same pattern as the order-status transition in orders.service.ts:
    // the WHERE re-checks revokedAt at the moment this UPDATE takes its row
    // lock, so only one caller can ever "win" rotating a given token even
    // under concurrency.
    const claimed = await this.db.execute(
      `UPDATE refreshtoken SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      // Lost the race, or this token was already rotated earlier — either
      // way, someone is presenting a token that's no longer the live edge
      // of this session's chain. Kill the whole family rather than just
      // this token: a stolen-then-reused token must not be able to keep
      // refreshing from wherever it branched off.
      await this.db.execute(
        `UPDATE refreshtoken SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL`,
        [new Date(), stored.familyId],
      );
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions revoked, please log in again',
      );
    }

    const user = await this.findById(stored.userId as number);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return this.issueTokenPair(user, stored.familyId as string);
  }

  // Revokes the whole session family the presented token belongs to (one
  // login = one family, refreshed many times) — not just that one token.
  // Idempotent and never reveals whether the token was valid, unknown, or
  // already revoked: logout always reports success.
  async logout(dto: { refreshToken: string }) {
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT familyId FROM refreshtoken WHERE tokenHash = ?`,
      [hashToken(dto.refreshToken)],
    );
    const stored = storedRows[0];
    if (stored) {
      await this.db.execute(
        `UPDATE refreshtoken SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL`,
        [new Date(), stored.familyId],
      );
    }
    return { success: true };
  }

  async me(ctx: TenantContext) {
    const user = await this.findByIdOrThrow(ctx.userId);
    return {
      ...this.toUserResponse(user),
      // Drives the impersonation banner in the merchant admin UI — see
      // AppChrome/ImpersonationBanner. Absent (not merely false) on a
      // normal session so a stale/older frontend build simply never
      // notices the field, no behavior change.
      impersonating: ctx.impersonatedByPlatformAdminId !== undefined,
    };
  }

  async createBranchUser(ctx: TenantContext, dto: CreateBranchUserDto) {
    const role = dto.role ?? 'branch';
    let outletId: number | null = null;
    if (role === 'branch') {
      const outletRows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
        [dto.outletId ?? null, ctx.shopId],
      );
      if (outletRows.length === 0) {
        throw new BadRequestException('Outlet does not belong to this shop');
      }
      outletId = outletRows[0].id as number;
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
    let userId: number;
    try {
      const result = await this.db.execute(
        `INSERT INTO user (shopId, outletId, name, email, passwordHash, role)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ctx.shopId, outletId, dto.name, dto.email, passwordHash, role],
      );
      userId = result.insertId;
    } catch (error) {
      this.handleUserCreateError(error);
    }
    const user = await this.findByIdOrThrow(userId);

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
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM authtoken WHERE tokenHash = ?`,
      [hashToken(dto.token)],
    );
    const stored = storedRows[0];
    if (
      !stored ||
      stored.purpose !== 'staff_invite' ||
      (stored.expiresAt as Date) < new Date()
    ) {
      throw new BadRequestException(
        'This invite link is invalid or has expired',
      );
    }
    const claimed = await this.db.execute(
      `UPDATE authtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      throw new BadRequestException('This invite link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.db.execute(
      `UPDATE user SET passwordHash = ?, emailVerified = true WHERE id = ?`,
      [passwordHash, stored.userId],
    );
    const user = await this.findByIdOrThrow(stored.userId as number);
    return this.issueTokenPair(user);
  }

  async listUsers(ctx: TenantContext) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.*, o.id AS outletJoinId, o.name AS outletName, s.name AS shopName
       FROM user u
       LEFT JOIN outlet o ON o.id = u.outletId
       JOIN shop s ON s.id = u.shopId
       WHERE u.shopId = ?
       ORDER BY u.id ASC`,
      [ctx.shopId],
    );
    return rows.map((r) => this.toUserResponse(this.rowToUser(r)));
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
    const existing = await this.findOne(ctx, id);
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
      const outletRows = requestedOutletId
        ? await this.db.query<RowDataPacket[]>(
            `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
            [requestedOutletId, ctx.shopId],
          )
        : [];
      if (outletRows.length === 0) {
        throw new BadRequestException(
          'A valid outletId is required for the branch role',
        );
      }
      outletId = outletRows[0].id as number;
    }

    const set = buildSetClause({
      name: dto.name,
      role: dto.role,
      outletId,
    });
    if (set) {
      await this.db.execute(`UPDATE user SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        id,
      ]);
    }
    const user = await this.findByIdOrThrow(id);
    return this.toUserResponse(user);
  }

  // Historical records (audit log, order notes, returns, stock movements,
  // scan batches) reference this user's id without ON DELETE CASCADE —
  // deliberately, so a staff departure never silently rewrites who did
  // what. Pre-checking here turns that into a clear, actionable error
  // instead of a raw FK constraint failure surfacing from the DB.
  async deleteStaffUser(ctx: TenantContext, id: number) {
    if (id === ctx.userId) {
      throw new BadRequestException(
        'Use your profile settings to manage your own account',
      );
    }
    const existing = await this.findOne(ctx, id);
    if (!existing) {
      throw new NotFoundException(`User ${id} not found`);
    }
    if (existing.role === 'admin') {
      await this.assertNotLastAdmin(ctx, id);
    }

    // Pure independent-read counts (no write involved) — a real transaction
    // buys no meaningful extra consistency for a pre-delete existence check,
    // so a plain Promise.all replaces the old array-form $transaction.
    const [notes, logs, batches, movements, returns] = await Promise.all([
      this.countWhere('ordernote', 'authorUserId', id),
      this.countWhere('auditlog', 'actorUserId', id),
      this.countWhere('scanbatch', 'actorUserId', id),
      this.countWhere('stockmovement', 'actorUserId', id),
      this.countWhere('orderreturn', 'staffUserId', id),
    ]);
    if (notes + logs + batches + movements + returns > 0) {
      throw new ConflictException(
        'Cannot delete this account: it has existing activity history (notes, audit log, stock movements, or returns). Reassign is not currently supported.',
      );
    }

    await this.db.execute(`DELETE FROM user WHERE id = ?`, [id]);
    return { id, deleted: true };
  }

  private async countWhere(
    table: string,
    column: string,
    value: number,
  ): Promise<number> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM \`${table}\` WHERE \`${column}\` = ?`,
      [value],
    );
    return Number(rows[0].c);
  }

  private async assertNotLastAdmin(
    ctx: TenantContext,
    excludingUserId: number,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM user WHERE shopId = ? AND role = 'admin' AND id != ?`,
      [ctx.shopId, excludingUserId],
    );
    if (Number(rows[0].c) === 0) {
      throw new BadRequestException(
        "Cannot remove the shop's only remaining admin",
      );
    }
  }

  async changePassword(ctx: TenantContext, dto: ChangePasswordDto) {
    const user = await this.findByIdOrThrow(ctx.userId);
    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Verify your email before changing your password',
      );
    }
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.db.transaction(async (conn) => {
      await conn.query(`UPDATE user SET passwordHash = ? WHERE id = ?`, [
        passwordHash,
        ctx.userId,
      ]);
      // A changed password should end every other session too, not just
      // require re-login on this one device eventually.
      await conn.query(
        `UPDATE refreshtoken SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL`,
        [new Date(), ctx.userId],
      );
      // A password-reset link issued before this change (e.g. an old email
      // still sitting in an inbox) must not still be redeemable afterward —
      // the password it would "reset" no longer matches what the user
      // thinks their account's state is.
      await conn.query(
        `UPDATE authtoken SET usedAt = ? WHERE userId = ? AND purpose = 'password_reset' AND usedAt IS NULL`,
        [new Date(), ctx.userId],
      );
    });
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.findByEmail(dto.email);
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
    await this.db.execute(
      `INSERT INTO authtoken (userId, purpose, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        user.id,
        'password_reset',
        hashToken(raw),
        new Date(Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60 * 1000),
      ],
    );
    const resetLink = `${ADMIN_URL}/reset-password?token=${raw}`;
    const resetHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">We received a request to reset your Requital password. This link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${resetLink}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Reset password</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${resetLink}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by Requital. If you didn't request a password reset, you can ignore this email.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await this.jobsService.enqueue(
      user.shopId,
      'send_email',
      {
        to: user.email,
        subject: 'Reset your Requital password',
        bodyText: `Reset your password: ${resetLink}\nThis link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
        html: resetHtml,
      },
      `staff-password-reset-email:${user.id}:${raw}`,
    );
    return { success: true, ...(isDev ? { devResetLink: resetLink } : {}) };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM authtoken WHERE tokenHash = ?`,
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
    // CAS on usedAt — a single-use token claimed exactly once even if the
    // reset form is somehow submitted twice concurrently.
    const claimed = await this.db.execute(
      `UPDATE authtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      throw new BadRequestException('This reset link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const userId = stored.userId as number;
    await this.db.transaction(async (conn) => {
      await conn.query(`UPDATE user SET passwordHash = ? WHERE id = ?`, [
        passwordHash,
        userId,
      ]);
      await conn.query(
        `UPDATE refreshtoken SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL`,
        [new Date(), userId],
      );
      // Defense in depth alongside forgotPassword's own supersession call —
      // any other reset token for this user (there normally shouldn't be
      // one, but a race between two forgot-password requests could leave a
      // second live one) dies the moment the password actually changes.
      await conn.query(
        `UPDATE authtoken SET usedAt = ? WHERE userId = ? AND purpose = 'password_reset' AND usedAt IS NULL`,
        [new Date(), userId],
      );
    });
    return { success: true };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const storedRows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM authtoken WHERE tokenHash = ?`,
      [hashToken(dto.token)],
    );
    const stored = storedRows[0];
    if (
      !stored ||
      stored.purpose !== 'email_verification' ||
      (stored.expiresAt as Date) < new Date()
    ) {
      throw new BadRequestException(
        'This verification link is invalid or has expired',
      );
    }
    const claimed = await this.db.execute(
      `UPDATE authtoken SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
      [new Date(), stored.id],
    );
    if (claimed.affectedRows === 0) {
      throw new BadRequestException(
        'This verification link has already been used',
      );
    }
    await this.db.execute(`UPDATE user SET emailVerified = true WHERE id = ?`, [
      stored.userId,
    ]);
    return { success: true };
  }

  async resendVerification(ctx: TenantContext) {
    const user = await this.findByIdOrThrow(ctx.userId);
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
    await this.db.execute(
      `INSERT INTO refreshtoken (userId, familyId, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        user.id,
        familyId ?? randomUUID(),
        hashToken(rawRefreshToken),
        new Date(
          Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
        ),
      ],
    );
    return {
      accessToken,
      accessTokenExpiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
      refreshToken: rawRefreshToken,
      user: this.toUserResponse(user),
    };
  }

  // Mints a token for a platform admin to act as a shop's own admin user —
  // called from PlatformAdminService.impersonate, which writes the audit
  // log entry immediately after this returns (before responding to the
  // platform admin), not deferred to whenever the session later "ends" —
  // the record must exist even if the process dies mid-session. Two
  // deliberate departures from a normal login token: capped at a short,
  // fixed lifetime (not the usual 15min-access/30-day-refresh pair) and no
  // refreshtoken row at all, so this session cannot be silently extended
  // past IMPERSONATION_TOKEN_LIFETIME by the normal refresh flow — it must
  // expire on its own like a real login never would.
  async issueImpersonationTokenForShop(
    shopId: number,
    platformAdminId: number,
  ) {
    const user = await this.findFirstAdminForShop(shopId);
    if (!user) {
      throw new NotFoundException(
        `Shop ${shopId} has no admin user to impersonate`,
      );
    }
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, typ: 'staff', imp: platformAdminId },
      { expiresIn: IMPERSONATION_TOKEN_LIFETIME },
    );
    return {
      accessToken,
      accessTokenExpiresIn: IMPERSONATION_TOKEN_LIFETIME_SECONDS,
      refreshToken: null,
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
    await this.db.execute(
      `UPDATE authtoken SET usedAt = ? WHERE userId = ? AND purpose = ? AND usedAt IS NULL`,
      [new Date(), userId, purpose],
    );
  }

  private async sendVerificationEmail(user: {
    id: number;
    email: string;
    shopId: number;
    name: string;
  }): Promise<string | undefined> {
    // Same supersession rule as forgotPassword above — a resend must kill
    // any still-outstanding verification token rather than leaving multiple
    // valid links alive at once. A no-op on the signup call site (nothing to
    // invalidate yet).
    await this.invalidateOutstandingTokens(user.id, 'email_verification');

    const raw = generateOpaqueToken();
    await this.db.execute(
      `INSERT INTO authtoken (userId, purpose, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        user.id,
        'email_verification',
        hashToken(raw),
        new Date(
          Date.now() + VERIFICATION_TOKEN_LIFETIME_HOURS * 60 * 60 * 1000,
        ),
      ],
    );
    const link = `${ADMIN_URL}/verify-email?token=${raw}`;
    const verifyHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">Please verify your email address to activate your Requital account.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Verify email</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${link}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by Requital. If you didn't create an account, you can ignore this email.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await this.jobsService.enqueue(
      user.shopId,
      'send_email',
      {
        to: user.email,
        subject: 'Verify your Requital email',
        bodyText: `Verify your email: ${link}`,
        html: verifyHtml,
      },
      `staff-verify-email:${user.id}:${raw}`,
    );
    return isDev ? link : undefined;
  }

  private async sendInviteEmail(user: {
    id: number;
    email: string;
    shopId: number;
    name: string;
  }): Promise<string | undefined> {
    const raw = generateOpaqueToken();
    await this.db.execute(
      `INSERT INTO authtoken (userId, purpose, tokenHash, expiresAt) VALUES (?, ?, ?, ?)`,
      [
        user.id,
        'staff_invite',
        hashToken(raw),
        new Date(Date.now() + INVITE_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      ],
    );
    const link = `${ADMIN_URL}/accept-invite?token=${raw}`;
    const inviteHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">Requital</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#111111;">You've been invited to a Requital staff account. Set your password to activate it — this link expires in ${INVITE_TOKEN_LIFETIME_DAYS} days.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background-color:#0d9488;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Set password</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#999999;font-family:monospace;word-break:break-all;">${link}</p>
</td></tr>
<tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:24px 40px 40px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by Requital. If you weren't expecting a staff invite, you can ignore this email.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
    await this.jobsService.enqueue(
      user.shopId,
      'send_email',
      {
        to: user.email,
        subject: "You've been invited to a Requital staff account",
        bodyText: `Set your password to activate your account: ${link}\nThis link expires in ${INVITE_TOKEN_LIFETIME_DAYS} days.`,
        html: inviteHtml,
      },
      `staff-invite-email:${user.id}:${raw}`,
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
    if (isDuplicateKeyError(error)) {
      throw new ConflictException('A user with this email already exists');
    }
    throw error;
  }

  // Shop name always joined in (matches SHOP_NAME_SELECT's old always-on
  // include); outlet only present when the row actually has one.
  private rowToUser(r: RowDataPacket): UserWithRelations {
    const user = { ...r } as unknown as UserWithRelations;
    user.shop = {
      name: r.shopName as string,
      suspendedAt: r.shopSuspendedAt as Date | null,
    };
    user.outlet =
      r.outletJoinId != null
        ? { id: r.outletJoinId as number, name: r.outletName as string }
        : null;
    const loose = user as unknown as Record<string, unknown>;
    delete loose.shopName;
    delete loose.shopSuspendedAt;
    delete loose.outletJoinId;
    delete loose.outletName;
    return user;
  }

  private async findById(id: number): Promise<UserWithRelations | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.*, o.id AS outletJoinId, o.name AS outletName, s.name AS shopName, s.suspendedAt AS shopSuspendedAt
       FROM user u
       LEFT JOIN outlet o ON o.id = u.outletId
       JOIN shop s ON s.id = u.shopId
       WHERE u.id = ?`,
      [id],
    );
    return rows[0] ? this.rowToUser(rows[0]) : null;
  }

  private async findByIdOrThrow(id: number): Promise<UserWithRelations> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  // Also used to find the shop's own admin to impersonate — see
  // issueImpersonationTokenForShop below.
  private async findFirstAdminForShop(
    shopId: number,
  ): Promise<UserWithRelations | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.*, o.id AS outletJoinId, o.name AS outletName, s.name AS shopName, s.suspendedAt AS shopSuspendedAt
       FROM user u
       LEFT JOIN outlet o ON o.id = u.outletId
       JOIN shop s ON s.id = u.shopId
       WHERE u.shopId = ? AND u.role = 'admin'
       ORDER BY u.id ASC
       LIMIT 1`,
      [shopId],
    );
    return rows[0] ? this.rowToUser(rows[0]) : null;
  }

  private async findByEmail(email: string): Promise<UserWithRelations | null> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.*, o.id AS outletJoinId, o.name AS outletName, s.name AS shopName, s.suspendedAt AS shopSuspendedAt
       FROM user u
       LEFT JOIN outlet o ON o.id = u.outletId
       JOIN shop s ON s.id = u.shopId
       WHERE u.email = ?`,
      [email],
    );
    return rows[0] ? this.rowToUser(rows[0]) : null;
  }

  private async findOne(
    ctx: TenantContext,
    id: number,
  ): Promise<UserRow | undefined> {
    const rows = await this.db.query<(UserRow & RowDataPacket)[]>(
      `SELECT * FROM user WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    return rows[0];
  }
}
