import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RowDataPacket } from 'mysql2';
import { DatabaseService } from '../../database/database.service';
import {
  REQUIRES_VERIFIED_EMAIL_KEY,
  type RequiresVerifiedEmailOptions,
} from '../decorators/requires-verified-email.decorator';
import type { TenantContext } from '../../common/tenant-context';

// Blocks the handful of outward-facing / credential-bearing merchant actions
// for a staff account whose email has never been verified. Everything else -
// login, the whole admin UI, products, outlets, theme, draft orders - stays
// open on purpose: an email-delivery problem must not lock a merchant out of
// their own account, which is the same reasoning ShopService.getPublishReadiness
// already records for the publish gate.
//
// Applied per-route with @UseGuards + @RequiresVerifiedEmail, not globally:
// the set of gated actions is short and deliberate, and a global default-deny
// would silently gate every new route somebody adds.
//
// The flag is re-read from the DB rather than taken off the token, matching
// AuthGuard's own discipline for role/outlet/suspension - so verifying in
// another tab takes effect on the very next request, with no re-login.
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options =
      this.reflector.getAllAndOverride<RequiresVerifiedEmailOptions>(
        REQUIRES_VERIFIED_EMAIL_KEY,
        [context.getHandler(), context.getClass()],
      );
    if (!options) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: TenantContext }>();

    if (options.whenBodyType !== undefined) {
      const body = request.body as { type?: unknown } | undefined;
      if (body?.type !== options.whenBodyType) return true;
    }

    // No context means AuthGuard did not admit this request, and it will have
    // rejected it already. Nothing to add here.
    const userId = request.user?.userId;
    if (userId === undefined) return true;

    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT emailVerified FROM user WHERE id = ?`,
      [userId],
    );
    if (rows.length > 0 && rows[0].emailVerified) return true;

    throw new ForbiddenException(
      `Verify your email address before ${options.action}. Check your inbox for the link we sent when you signed up, or use Resend on the verification banner in the admin.`,
    );
  }
}
