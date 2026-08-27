import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { CustomerContext } from './customer-context';
import { CUSTOMER_ACCESS_COOKIE } from './customer-auth.constants';

interface CustomerJwtPayload {
  sub: number;
  typ: 'customer';
}

// Every route this guards lives under /public/:shopSlug/account — always
// marked @Public() (so the global staff AuthGuard skips it) and this guard
// applied locally instead (see customer-account.controller.ts). Two checks
// beyond "is this a valid JWT" matter here:
//   1. `typ: 'customer'` must be present — CUSTOMER_JWT_SECRET (see
//      CustomerAuthModule) already makes a staff token fail verifyAsync
//      outright, so this is defense in depth, not the only thing stopping a
//      staff token whose numeric `sub` happens to match a customer.id from
//      authenticating as that customer (see AuthGuard's matching
//      `typ: 'staff'` check on the other side).
//   2. The resolved customer's shopId must match the shop resolved from
//      this request's :shopSlug — a customer's account token must never
//      work against a different shop's /account endpoints, even for the
//      same numeric customerId (see CustomerAuthService.issueTokenPair —
//      customerId is a per-shop identity, not global).
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing session cookie');
    }

    let payload: CustomerJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<CustomerJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'customer') {
      throw new UnauthorizedException('Invalid token type');
    }

    const shopSlug = request.params.shopSlug as string;
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE subdomain = ?`,
      [shopSlug],
    );
    const shop = shopRows[0];
    if (!shop) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }

    // Re-read from the DB on every request, same discipline as the staff
    // AuthGuard — a password change (which revokes sessions) or the account
    // somehow losing its registration takes effect immediately, not at the
    // end of the access token's lifetime.
    const customerRows = await this.db.query<RowDataPacket[]>(
      `SELECT id, shopId, passwordHash FROM customer WHERE id = ?`,
      [payload.sub],
    );
    const customer = customerRows[0];
    if (!customer || !customer.passwordHash) {
      throw new UnauthorizedException('Account no longer exists');
    }
    if (customer.shopId !== shop.id) {
      throw new UnauthorizedException(
        'This session is not valid for this shop',
      );
    }

    const customerContext: CustomerContext = {
      customerId: customer.id,
      shopId: customer.shopId,
    };
    (request as Request & { customer: CustomerContext }).customer =
      customerContext;
    return true;
  }

  // Session-cookie migration (security audit finding #1), phase 3. No
  // bearer-header fallback anywhere, including tests — see
  // customer-auth.controller.ts's own comment on why this tier's small e2e
  // surface (3 specs) was converted outright instead of the staff tier's
  // NODE_ENV=test compatibility shim.
  private extractToken(request: Request): string | null {
    const raw: unknown = request.cookies?.[CUSTOMER_ACCESS_COOKIE];
    return typeof raw === 'string' && raw ? raw : null;
  }
}
