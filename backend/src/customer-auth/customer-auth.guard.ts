import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerContext } from './customer-context';

interface CustomerJwtPayload {
  sub: number;
  typ: 'customer';
}

// Every route this guards lives under /public/:shopSlug/account — always
// marked @Public() (so the global staff AuthGuard skips it) and this guard
// applied locally instead (see customer-account.controller.ts). Two checks
// beyond "is this a valid JWT" are what actually make this safe to run
// alongside the staff auth system on a shared JWT secret:
//   1. `typ: 'customer'` must be present — without this, a staff access
//      token (same secret, `{sub: user.id}`) whose numeric id happens to
//      match some customer.id would authenticate as that customer, and vice
//      versa on the staff side (see AuthGuard's matching `typ: 'staff'`
//      check).
//   2. The resolved customer's shopId must match the shop resolved from
//      this request's :shopSlug — a customer's account token must never
//      work against a different shop's /account endpoints, even for the
//      same numeric customerId (see CustomerAuthService.issueTokenPair —
//      customerId is a per-shop identity, not global).
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
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
    const shop = await this.prisma.shop.findUnique({
      where: { subdomain: shopSlug },
    });
    if (!shop) {
      throw new NotFoundException(`Shop '${shopSlug}' not found`);
    }

    // Re-read from the DB on every request, same discipline as the staff
    // AuthGuard — a password change (which revokes sessions) or the account
    // somehow losing its registration takes effect immediately, not at the
    // end of the access token's lifetime.
    const customer = await this.prisma.customer.findUnique({
      where: { id: payload.sub },
    });
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

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
  }
}
