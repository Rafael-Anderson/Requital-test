import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CustomerAuthService } from './customer-auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { ForgotCustomerPasswordDto } from './dto/forgot-customer-password.dto';
import { ResetCustomerPasswordDto } from './dto/reset-customer-password.dto';
import { Public } from '../auth/decorators/public.decorator';
import {
  CUSTOMER_ACCESS_COOKIE,
  CUSTOMER_ACCESS_COOKIE_MAX_AGE_MS,
  CUSTOMER_REFRESH_COOKIE,
  customerAccessPath,
  customerRefreshPath,
  customerCsrf,
} from './customer-auth.constants';
import { sessionCookieOptions } from '../common/cookies';

function setCustomerSessionCookies(
  req: Request,
  res: Response,
  shopSlug: string,
  session: { accessToken: string; refreshToken: string },
) {
  res.cookie(
    CUSTOMER_ACCESS_COOKIE,
    session.accessToken,
    sessionCookieOptions(
      customerAccessPath(shopSlug),
      CUSTOMER_ACCESS_COOKIE_MAX_AGE_MS,
    ),
  );
  res.cookie(
    CUSTOMER_REFRESH_COOKIE,
    session.refreshToken,
    sessionCookieOptions(customerRefreshPath(shopSlug)),
  );
  customerCsrf.issue(req, res, session.accessToken, {
    cookiePath: customerAccessPath(shopSlug),
  });
}

// Unauthenticated (or, for refresh/logout, authenticated by the refresh
// token itself) and shop-scoped by :shopSlug — same URL convention as
// PublicController. @Public() at the class level so the global staff
// AuthGuard skips every route here; none of these need a customer session
// yet either (see CustomerAccountController for the ones that do).
@Public()
@Controller('public/:shopSlug/auth')
export class CustomerAuthController {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  // Same rationale as auth.controller.ts's staff endpoints — 5/min/IP on
  // every credential/token-issuing or enumeration-sensitive route here.
  //
  // Session-cookie migration (security audit finding #1), phase 3 — see
  // CLAUDE.md's "Session-cookie migration, phase 3 of 3" note. Every
  // token-issuing method here sets the two customer cookies, Path-scoped to
  // this one shop, instead of returning tokens in the JSON body — no
  // NODE_ENV=test body-passthrough exception the way AuthController has
  // (see that file's own comment): this tier only touches 3 existing e2e
  // specs, a small enough surface to convert to real cookie assertions
  // rather than special-case around.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  async register(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: RegisterCustomerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.customerAuthService.register(shopSlug, dto);
    setCustomerSessionCookies(req, res, shopSlug, session);
    return { customer: session.customer };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: LoginCustomerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.customerAuthService.login(shopSlug, dto);
    setCustomerSessionCookies(req, res, shopSlug, session);
    return { customer: session.customer };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('refresh')
  async refresh(
    @Param('shopSlug') shopSlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken: unknown = req.cookies?.[CUSTOMER_REFRESH_COOKIE];
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const session = await this.customerAuthService.refresh(shopSlug, {
      refreshToken,
    });
    setCustomerSessionCookies(req, res, shopSlug, session);
    return { customer: session.customer };
  }

  @Post('logout')
  async logout(
    @Param('shopSlug') shopSlug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken: unknown = req.cookies?.[CUSTOMER_REFRESH_COOKIE];
    if (typeof refreshToken === 'string' && refreshToken) {
      await this.customerAuthService.logout({ refreshToken });
    }
    res.clearCookie(
      CUSTOMER_ACCESS_COOKIE,
      sessionCookieOptions(customerAccessPath(shopSlug)),
    );
    res.clearCookie(
      CUSTOMER_REFRESH_COOKIE,
      sessionCookieOptions(customerRefreshPath(shopSlug)),
    );
    return { success: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: ForgotCustomerPasswordDto,
  ) {
    return this.customerAuthService.forgotPassword(shopSlug, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetCustomerPasswordDto) {
    return this.customerAuthService.resetPassword(dto);
  }
}
