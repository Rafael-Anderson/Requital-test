import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac } from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { TenantContext } from '../common/tenant-context';
import { MfaStore } from './mfa-store';
import { generateTotpSecret, otpauthUri } from './totp';

const ISSUER = 'Requital';
const MFA_TOKEN_LIFETIME = '5m';

// The pending-login token. Signed with a key DERIVED from JWT_SECRET (not
// JWT_SECRET itself), so it fails signature verification against AuthGuard's
// verifier and a session token fails against this one, in addition to the `typ`
// checks on both sides. It authorises exactly one thing: POST /auth/login/mfa.
export function staffMfaSecret(): string {
  return createHmac('sha256', process.env.JWT_SECRET ?? '')
    .update('staff-mfa-token-v1')
    .digest('hex');
}

// Binds a pending token to the password it was minted for: changing or
// resetting the password in the five minutes between steps kills it.
function passwordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

interface MfaTokenPayload {
  sub: number;
  typ?: string;
  pwf?: string;
}

@Injectable()
export class TwoFactorService {
  private readonly store: MfaStore;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditLogService,
  ) {
    this.store = new MfaStore(db, 'staff');
  }

  isEnrolled(userId: number) {
    return this.store.isEnrolled(userId);
  }

  // ---- login (called by AuthService) ----

  async issueMfaToken(user: { id: number; passwordHash: string }) {
    return this.jwt.signAsync(
      {
        sub: user.id,
        typ: 'staff_mfa',
        pwf: passwordFingerprint(user.passwordHash),
      },
      { secret: staffMfaSecret(), expiresIn: MFA_TOKEN_LIFETIME },
    );
  }

  // Returns the user id and the fingerprint to compare against the CURRENT
  // password hash. Any problem is the same generic 401.
  async readMfaToken(token: string): Promise<{ userId: number; pwf: string }> {
    let p: MfaTokenPayload;
    try {
      p = await this.jwt.verifyAsync<MfaTokenPayload>(token, {
        secret: staffMfaSecret(),
      });
    } catch {
      throw new UnauthorizedException('Your sign-in expired. Start again.');
    }
    if (p.typ !== 'staff_mfa' || typeof p.sub !== 'number' || !p.pwf) {
      throw new UnauthorizedException('Your sign-in expired. Start again.');
    }
    return { userId: p.sub, pwf: p.pwf };
  }

  matchesPassword(pwf: string, passwordHash: string): boolean {
    return pwf === passwordFingerprint(passwordHash);
  }

  verifyLoginCode(userId: number, code: string) {
    return this.store.verify(userId, code, Date.now());
  }

  // ---- own account ----

  async status(ctx: TenantContext) {
    const [s, shop] = await Promise.all([
      this.store.status(ctx.userId),
      this.shopRequires(ctx.shopId),
    ]);
    return { ...s, shopRequired: shop };
  }

  // For GET /auth/me: is two-factor on, and must this session enrol before
  // doing anything else. An impersonation token is never gated.
  async meState(ctx: TenantContext) {
    const [enabled, shopRequired, mustEnrol] = await Promise.all([
      this.store.isEnrolled(ctx.userId),
      this.shopRequires(ctx.shopId),
      this.userMustEnrol(ctx.userId),
    ]);
    return {
      enabled,
      enrollmentRequired:
        (shopRequired || mustEnrol) &&
        !enabled &&
        ctx.impersonatedByPlatformAdminId === undefined,
    };
  }

  // Re-auth (current password) so that a stolen session alone cannot enrol an
  // attacker's authenticator and lock the real owner out.
  async startEnrollment(ctx: TenantContext, currentPassword: string) {
    this.assertNotImpersonating(ctx);
    const user = await this.userRow(ctx.userId);
    await this.assertPassword(user, currentPassword);
    if (await this.store.isEnrolled(ctx.userId)) {
      throw new ConflictException(
        'Two-factor is already on. Turn it off first to set up a new device.',
      );
    }
    const secret = generateTotpSecret();
    if (!(await this.store.beginEnrollment(ctx.userId, secret))) {
      throw new ConflictException('Two-factor is already on.');
    }
    return {
      secret,
      otpauthUri: otpauthUri({
        issuer: ISSUER,
        account: user.email as string,
        secret,
      }),
    };
  }

  async confirmEnrollment(ctx: TenantContext, code: string) {
    this.assertNotImpersonating(ctx);
    // Completing enrolment clears a platform-reset "must enrol" flag in the same
    // transaction that confirms the secret.
    const codes = await this.store.confirmEnrollment(
      ctx.userId,
      code,
      Date.now(),
      async (conn) => {
        await conn.query(`UPDATE user SET mustEnrol2fa = 0 WHERE id = ?`, [
          ctx.userId,
        ]);
      },
    );
    if (!codes) {
      throw new BadRequestException(
        'There is no set-up in progress. Start again.',
      );
    }
    await this.audit.logCtx(ctx, {
      action: 'auth.2fa_enabled',
      entityType: 'auth',
      entityId: ctx.userId,
    });
    return { recoveryCodes: codes };
  }

  // Turning your own second factor off needs a current valid code (or an
  // unused recovery code), and is refused outright while the shop requires it.
  async disable(ctx: TenantContext, code: string) {
    this.assertNotImpersonating(ctx);
    if (await this.shopRequires(ctx.shopId)) {
      throw new ForbiddenException(
        'Your shop requires two-factor authentication, so it cannot be turned off.',
      );
    }
    await this.store.verify(ctx.userId, code, Date.now());
    await this.store.disable(ctx.userId);
    await this.audit.logCtx(ctx, {
      action: 'auth.2fa_disabled',
      entityType: 'auth',
      entityId: ctx.userId,
    });
    return { success: true };
  }

  async regenerateRecoveryCodes(
    ctx: TenantContext,
    currentPassword: string,
    code: string,
  ) {
    this.assertNotImpersonating(ctx);
    const user = await this.userRow(ctx.userId);
    await this.assertPassword(user, currentPassword);
    await this.store.verify(ctx.userId, code, Date.now());
    const codes = await this.store.regenerateRecoveryCodes(ctx.userId);
    await this.audit.logCtx(ctx, {
      action: 'auth.2fa_recovery_codes_regenerated',
      entityType: 'auth',
      entityId: ctx.userId,
    });
    return { recoveryCodes: codes };
  }

  // ---- admin, same shop ----

  // For a colleague who lost their device AND their recovery codes. Never for
  // yourself: a stolen admin session must not be able to strip the second
  // factor without a code (use disable). Also ends the target's sessions.
  async adminReset(ctx: TenantContext, targetUserId: number) {
    this.assertNotImpersonating(ctx);
    if (targetUserId === ctx.userId) {
      throw new BadRequestException(
        'Use "Turn off two-factor" for your own account.',
      );
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM user WHERE id = ? AND shopId = ?`,
      [targetUserId, ctx.shopId],
    );
    if (rows.length === 0) throw new NotFoundException('User not found');
    await this.store.disable(targetUserId);
    await this.db.execute(
      `UPDATE refreshtoken SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL`,
      [new Date(), targetUserId],
    );
    await this.audit.logCtx(ctx, {
      action: 'auth.2fa_reset_by_admin',
      entityType: 'user',
      entityId: targetUserId,
    });
    return { success: true };
  }

  // The shop-wide switch. Turning it ON needs the acting admin to be enrolled
  // already (otherwise they would lock themselves into the enrolment-only
  // scope); turning it OFF needs their current code, so a hijacked admin session
  // cannot quietly lower the shop's protection.
  async setShopPolicy(ctx: TenantContext, required: boolean, code?: string) {
    this.assertNotImpersonating(ctx);
    const enrolled = await this.store.isEnrolled(ctx.userId);
    if (required && !enrolled) {
      throw new BadRequestException(
        'Set up two-factor on your own account first.',
      );
    }
    const current = await this.shopRequires(ctx.shopId);
    if (!required && current) {
      if (!code)
        throw new BadRequestException('Enter a current code to turn this off.');
      await this.store.verify(ctx.userId, code, Date.now());
    }
    await this.db.execute(`UPDATE shop SET require2fa = ? WHERE id = ?`, [
      required,
      ctx.shopId,
    ]);
    await this.audit.logCtx(ctx, {
      action: 'shop.require_2fa_changed',
      entityType: 'shop',
      entityId: ctx.shopId,
      before: { require2fa: current },
      after: { require2fa: required },
    });
    return { shopRequired: required };
  }

  // ---- helpers ----

  private async shopRequires(shopId: number): Promise<boolean> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT require2fa FROM shop WHERE id = ?`,
      [shopId],
    );
    return !!rows[0]?.require2fa;
  }

  private async userMustEnrol(userId: number): Promise<boolean> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT mustEnrol2fa FROM user WHERE id = ?`,
      [userId],
    );
    return !!rows[0]?.mustEnrol2fa;
  }

  private async userRow(userId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id, email, passwordHash FROM user WHERE id = ?`,
      [userId],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return rows[0];
  }

  private async assertPassword(user: RowDataPacket, password: string) {
    if (!(await bcrypt.compare(password, user.passwordHash as string))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
  }

  // A platform admin impersonating a shop must never manage that user's second
  // factor (it would be an account takeover with extra steps).
  private assertNotImpersonating(ctx: TenantContext) {
    if (ctx.impersonatedByPlatformAdminId !== undefined) {
      throw new ForbiddenException('Not available while impersonating');
    }
  }
}
