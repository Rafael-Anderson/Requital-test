import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_PENDING_MFA_KEY } from '../decorators/allow-pending-mfa.decorator';
import { STAFF_ACCESS_COOKIE } from '../auth.constants';
import type { TenantContext, UserRole } from '../../common/tenant-context';

interface JwtPayload {
  sub: number;
  typ?: 'staff';
  // Set only on an impersonation token — see
  // AuthService.issueImpersonationTokenForShop. Not trusted for anything
  // beyond surfacing "you are impersonating" back to the client; every
  // real access-control decision still runs off the re-fetched user row
  // below, same as every other claim this guard reads.
  imp?: number;
  // Session id = refresh-token family id (see AuthService.issueTokenPair).
  sid?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing session cookie');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // Customer tokens are signed with a genuinely separate secret now
    // (CUSTOMER_JWT_SECRET, see CustomerAuthModule) and fail verifyAsync
    // above outright, so this check is defense in depth rather than the
    // only thing keeping the two token spaces apart — kept anyway per
    // CustomerAuthGuard's matching `typ: 'customer'` check on the other
    // side. Tokens issued before this check existed lack `typ` entirely and
    // are rejected too; any such session self-heals on its very next
    // request via the admin app's existing 401 -> silent-refresh flow,
    // since AuthService.issueTokenPair now always sets typ: 'staff'.
    if (payload.typ !== 'staff') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Re-read role/shop/outlet from the DB on every request instead of
    // trusting the token's claims: an admin reassigning a branch user to a
    // different outlet, or deleting the account, takes effect on the very
    // next request rather than lingering for the rest of the token's 7-day
    // lifetime.
    //
    // The same single query also answers "is this token's session still live?"
    // (STF-4): a normal session token carries `sid` (its refresh-token
    // family) and is only honoured while that family has an unrevoked,
    // unexpired refresh row. That is what makes a remote revoke, a logout, a
    // password change or a refresh-token reuse alarm cut access immediately
    // rather than after the 15 minute access token. Token shapes:
    //   - normal session token: has `sid`, must be live.
    //   - impersonation token (`imp`): minted with no refresh row at all, so no
    //     session to check; it simply expires on its own after 1 hour.
    //   - anything else (no sid, no imp): a token issued before this check
    //     existed. Rejected, and self-heals through the admin app's 401 ->
    //     silent-refresh flow, exactly like the missing-`typ` case above.
    const isImpersonation = payload.imp !== undefined;
    if (!isImpersonation && typeof payload.sid !== 'string') {
      throw new UnauthorizedException('Invalid session');
    }
    const sid = isImpersonation ? null : payload.sid!;
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.id, u.shopId, u.role, u.outletId, s.suspendedAt,
              EXISTS(SELECT 1 FROM refreshtoken r
                     WHERE r.familyId = ? AND r.userId = u.id
                       AND r.revokedAt IS NULL AND r.expiresAt > ?) AS sessionLive,
              s.require2fa AS shopRequires2fa,
              u.mustEnrol2fa AS mustEnrol2fa,
              EXISTS(SELECT 1 FROM usertotp t
                     WHERE t.userId = u.id AND t.confirmedAt IS NOT NULL) AS mfaEnrolled
       FROM user u JOIN shop s ON s.id = u.shopId
       WHERE u.id = ?`,
      [sid ?? '', new Date(), payload.sub],
    );
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (sid !== null && !user.sessionLive) {
      throw new UnauthorizedException('Session ended');
    }
    // Re-checked every request, not just at login — a shop suspended by a
    // platform admin mid-session must be locked out on its very next
    // request, matching this guard's existing re-read-every-request
    // philosophy for role/outlet changes. See PlatformAdminService.suspend.
    if (user.suspendedAt) {
      throw new ForbiddenException('This shop has been suspended');
    }

    // Per-user "must enrol" (S1a): set by a platform-admin 2FA reset, so a user
    // whose second factor was removed cannot carry on without one even when the
    // shop does not require it. Same confinement, same single query.
    // Shop-wide "require two-factor" (STF-3). Evaluated on EVERY request from
    // the row just read, so flipping the switch restricts users who are already
    // signed in at once, and enrolling lifts it on the same session. A session
    // that still has to enrol may only call the routes marked
    // @AllowPendingMfa (me, the 2FA enrolment endpoints); everything else is a
    // 403 with a stable code. Impersonation is exempt: the platform admin's
    // own second factor is the control there, and the enrolment endpoints
    // themselves refuse an impersonation token.
    if (
      !isImpersonation &&
      (user.shopRequires2fa || user.mustEnrol2fa) &&
      !user.mfaEnrolled &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        message:
          'Two-factor authentication is required for your account. Set it up to continue.',
        code: 'mfa_enrollment_required',
      });
    }

    const tenantContext: TenantContext = {
      userId: user.id,
      shopId: user.shopId,
      role: user.role as UserRole,
      outletId: user.outletId,
      ...(payload.imp !== undefined
        ? { impersonatedByPlatformAdminId: payload.imp }
        : {}),
      ...(sid !== null ? { sessionId: sid } : {}),
    };
    (request as Request & { user: TenantContext }).user = tenantContext;
    return true;
  }

  // Session-cookie migration (security audit finding #1), phase 2. No
  // bearer-header fallback in production or dev — a clean cut-over, same
  // reasoning as PlatformAdminGuard's own (phase 1). The one exception is
  // narrowly scoped to NODE_ENV=test: rewriting every one of this app's ~60
  // existing e2e specs (each with its own local setupShop-style helper) to
  // a hand-built cookie jar was judged not worth the risk of a mechanical
  // edit at that scale for a testing-only concern — the guard's downstream
  // role/tenant-context logic is byte-for-byte identical regardless of
  // which branch extracted the token, so those specs' actual business-logic
  // coverage is unaffected either way. Real cookie+CSRF behavior is proven
  // separately by auth-cookies.e2e-spec.ts. This mirrors an already-
  // established pattern in this codebase (ThrottlerModule's own
  // `skipIf: () => process.env.NODE_ENV === 'test'` in app.module.ts) —
  // inert outside Jest, never a live code path in production or dev.
  private extractToken(request: Request): string | null {
    const cookieToken: unknown = request.cookies?.[STAFF_ACCESS_COOKIE];
    if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
    if (process.env.NODE_ENV === 'test') {
      const header = request.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        return header.slice('Bearer '.length).trim() || null;
      }
    }
    return null;
  }
}
