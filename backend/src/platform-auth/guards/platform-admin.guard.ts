import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { PLATFORM_ACCESS_COOKIE } from '../platform-auth.constants';
import { ALLOW_PENDING_MFA_KEY } from '../../auth/decorators/allow-pending-mfa.decorator';
import { platformRequires2fa } from '../platform-two-factor.service';

export interface PlatformAdminContext {
  id: number;
  email: string;
  name: string;
}

interface PlatformJwtPayload {
  sub: number;
  typ?: 'platform';
}

// Applied per-controller via @UseGuards, NOT as a global APP_GUARD — this
// must never run against merchant/storefront routes, only the handful of
// /platform-admin, /platform-auth/me-style controllers that opt in. A
// separate JwtService instance (own secret, PLATFORM_JWT_SECRET) is what
// actually keeps a merchant token and a platform token from ever being
// interchangeable — the `typ: 'platform'` check below is defense in depth
// on top of that, same two-layer shape AuthGuard/CustomerAuthGuard already
// use for their own token spaces.
//
// Every failure path — missing header, malformed/expired token, wrong typ,
// admin no longer exists — collapses to the same 404, never 401/403: an
// unauthenticated scan of this API must not be able to tell this surface
// exists at all. See CLAUDE.md's platform-admin section.
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new NotFoundException();

    let payload: PlatformJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PlatformJwtPayload>(token);
    } catch {
      throw new NotFoundException();
    }
    if (payload.typ !== 'platform') throw new NotFoundException();

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT a.id, a.email, a.name,
              EXISTS(SELECT 1 FROM platformadmintotp t
                     WHERE t.platformAdminId = a.id AND t.confirmedAt IS NOT NULL) AS mfaEnrolled
       FROM platformadmin a WHERE a.id = ?`,
      [payload.sub],
    );
    const admin = rows[0];
    if (!admin) throw new NotFoundException();

    // PLATFORM_REQUIRE_2FA=1: an admin who has not enrolled may only reach the
    // routes marked @AllowPendingMfa (me, the 2FA enrolment endpoints). They
    // are already authenticated, so unlike every other failure here this one
    // says why (403 with a code) instead of pretending the route is missing.
    if (
      platformRequires2fa() &&
      !admin.mfaEnrolled &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_MFA_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        message:
          'Platform sign-in requires two-factor authentication. Set it up to continue.',
        code: 'mfa_enrollment_required',
      });
    }

    (
      request as Request & { platformAdmin: PlatformAdminContext }
    ).platformAdmin = {
      id: admin.id as number,
      email: admin.email as string,
      name: admin.name as string,
    };
    return true;
  }

  // Session-cookie migration (security audit finding #1) — reads the
  // httpOnly cookie instead of an Authorization header. No bearer-header
  // fallback: this is a clean cut-over (see CLAUDE.md's platform-admin
  // section for the migration-path reasoning), not a transition window.
  private extractToken(request: Request): string | null {
    const raw: unknown = request.cookies?.[PLATFORM_ACCESS_COOKIE];
    return typeof raw === 'string' && raw ? raw : null;
  }
}
