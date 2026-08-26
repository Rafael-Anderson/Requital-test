import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import { PLATFORM_ACCESS_COOKIE } from '../platform-auth.constants';

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
      `SELECT id, email, name FROM platformadmin WHERE id = ?`,
      [payload.sub],
    );
    const admin = rows[0];
    if (!admin) throw new NotFoundException();

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
