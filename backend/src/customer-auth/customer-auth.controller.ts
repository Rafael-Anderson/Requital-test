import {
  Body,
  Controller,
  HttpCode,
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
import { PhoneOtpService } from './phone-otp.service';
import { SendPhoneOtpDto } from './dto/send-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { VerifyCustomerEmailDto } from './dto/verify-customer-email.dto';
import { Public } from '../auth/decorators/public.decorator';
import {
  CUSTOMER_ACCESS_COOKIE_MAX_AGE_MS,
  CUSTOMER_COOKIE_PATH,
  customerCookieNames,
  customerCsrf,
  legacyCustomerCookies,
} from './customer-auth.constants';
import { sessionCookieOptions } from '../common/cookies';

function setCustomerSessionCookies(
  req: Request,
  res: Response,
  shopSlug: string,
  session: { accessToken: string; refreshToken: string },
) {
  const names = customerCookieNames(shopSlug);
  // The shop exists by now (login/register/refresh resolved it), so its slug is
  // a valid cookie name part. Refusing is the safe answer if that ever stops being true.
  if (!names) throw new UnauthorizedException('Invalid shop');
  res.cookie(
    names.access,
    session.accessToken,
    sessionCookieOptions(
      CUSTOMER_COOKIE_PATH,
      CUSTOMER_ACCESS_COOKIE_MAX_AGE_MS,
    ),
  );
  res.cookie(
    names.refresh,
    session.refreshToken,
    sessionCookieOptions(CUSTOMER_COOKIE_PATH),
  );
  customerCsrf.issue(req, res, shopSlug, session.accessToken);
}

// Unauthenticated (or, for refresh/logout, authenticated by the refresh
// token itself) and shop-scoped by :shopSlug — same URL convention as
// PublicController. @Public() at the class level so the global staff
// AuthGuard skips every route here; none of these need a customer session
// yet either (see CustomerAccountController for the ones that do).
@Public()
@Controller('public/:shopSlug/auth')
export class CustomerAuthController {
  constructor(
    private readonly customerAuthService: CustomerAuthService,
    private readonly phoneOtp: PhoneOtpService,
  ) {}

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
    const names = customerCookieNames(shopSlug);
    const refreshToken: unknown = names
      ? req.cookies?.[names.refresh]
      : undefined;
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
    const names = customerCookieNames(shopSlug);
    const refreshToken: unknown = names
      ? req.cookies?.[names.refresh]
      : undefined;
    if (typeof refreshToken === 'string' && refreshToken) {
      await this.customerAuthService.logout({ refreshToken });
    }
    if (names) {
      for (const name of [names.access, names.refresh, names.csrf]) {
        res.clearCookie(name, sessionCookieOptions(CUSTOMER_COOKIE_PATH));
      }
      for (const { name, path } of legacyCustomerCookies(
        shopSlug.toLowerCase(),
      )) {
        res.clearCookie(name, sessionCookieOptions(path));
      }
    }
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

  // Pre-session and token-carrying, like reset-password: the link is opened from
  // an inbox, often in a browser with no storefront session.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyCustomerEmailDto) {
    return this.customerAuthService.verifyEmail(dto.token);
  }

  // Phone OTP (404 unless the shop has phone_otp_register on). The answer is a
  // fixed 202 whatever happened behind it. Per-phone, per-shop and country limits
  // live in PhoneOtpService; this is the per-IP layer.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(202)
  @Post('phone-otp/send')
  async sendPhoneOtp(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: SendPhoneOtpDto,
  ) {
    await this.phoneOtp.send(shopSlug, dto.phone);
    return { accepted: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('phone-otp/verify')
  verifyPhoneOtp(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: VerifyPhoneOtpDto,
  ) {
    return this.phoneOtp.verify(shopSlug, dto.phone, dto.code);
  }
}
