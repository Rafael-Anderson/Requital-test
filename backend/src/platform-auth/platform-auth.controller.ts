import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { CurrentPlatformAdmin } from './decorators/current-platform-admin.decorator';
import type { PlatformAdminContext } from './guards/platform-admin.guard';
import { Public } from '../auth/decorators/public.decorator';
import {
  PLATFORM_ACCESS_COOKIE,
  platformCsrf,
} from './platform-auth.constants';
import { sessionCookieOptions } from '../common/cookies';

// @Public() at class level opts every route here out of the GLOBAL merchant
// AuthGuard (an APP_GUARD, so it otherwise runs in front of every
// controller in the app, this one included). Real protection for the
// non-login routes below comes from @UseGuards(PlatformAdminGuard) instead
// — a completely separate guard/JWT scope, not "no auth at all". Same
// two-layer shape the old PlatformAdminController used with @Public() +
// its shared-secret check, just with a real guard now.
@Public()
@Controller('platform-auth')
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  // Aggressively rate-limited, tighter than merchant login's already-tight
  // 5/min — this endpoint gates access to every shop on the platform, not
  // one shop. Paired with PlatformAuthService's own per-account progressive
  // lockout for the distributed-attacker case a per-IP limit alone misses.
  //
  // @Res({ passthrough: true }) — session-cookie migration (security audit
  // finding #1): the access token is set as an httpOnly cookie, not
  // returned in the JSON body at all. `platformCsrf.issue` mints the
  // paired CSRF cookie for this brand-new session (excluded from CSRF
  // *checking* itself — see AppModule.configure — since there's nothing to
  // forge yet on a not-yet-authenticated login attempt).
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() dto: PlatformLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.platformAuthService.login(dto);
    res.cookie(
      PLATFORM_ACCESS_COOKIE,
      session.accessToken,
      sessionCookieOptions('/'),
    );
    platformCsrf.issue(req, res, session.accessToken);
    return { admin: session.admin };
  }

  // Lets the platform admin frontend hydrate/validate a stored session on
  // mount, mirroring GET /auth/me's role for the merchant app. Also the
  // bootstrap point for CSRF token distribution (see common/csrf.ts's own
  // top comment) — a fresh page load/new tab has no in-memory CSRF value
  // left over from login, so this hands one back via the response header
  // every time, reusing the existing cookie's value rather than rotating it
  // (a rotation here would silently invalidate the token any other already-
  // open tab is still holding).
  @UseGuards(PlatformAdminGuard)
  @Get('me')
  me(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken: unknown = req.cookies?.[PLATFORM_ACCESS_COOKIE];
    if (typeof accessToken === 'string' && accessToken) {
      platformCsrf.issue(req, res, accessToken, { reuseExisting: true });
    }
    return admin;
  }

  // Deliberately NOT behind PlatformAdminGuard — an expired (but still
  // present) access-token cookie must still be clearable client-side, and
  // the guard would 404 before this handler ever ran. httpOnly cookies
  // can only be cleared server-side (this endpoint didn't need to exist
  // before the cookie migration — the frontend could just drop its own
  // localStorage key).
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(PLATFORM_ACCESS_COOKIE, sessionCookieOptions('/'));
    return { success: true };
  }
}
