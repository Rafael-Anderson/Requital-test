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
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // Same JWT secret as CustomerAuthModule's storefront tokens — without
    // this check, a customer token whose numeric `sub` happens to match a
    // real staff user.id would authenticate as that staff member. See
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
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT u.id, u.shopId, u.role, u.outletId, s.suspendedAt
       FROM user u JOIN shop s ON s.id = u.shopId
       WHERE u.id = ?`,
      [payload.sub],
    );
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    // Re-checked every request, not just at login — a shop suspended by a
    // platform admin mid-session must be locked out on its very next
    // request, matching this guard's existing re-read-every-request
    // philosophy for role/outlet changes. See PlatformAdminService.suspend.
    if (user.suspendedAt) {
      throw new ForbiddenException('This shop has been suspended');
    }

    const tenantContext: TenantContext = {
      userId: user.id,
      shopId: user.shopId,
      role: user.role as UserRole,
      outletId: user.outletId,
      ...(payload.imp !== undefined
        ? { impersonatedByPlatformAdminId: payload.imp }
        : {}),
    };
    (request as Request & { user: TenantContext }).user = tenantContext;
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
  }
}
