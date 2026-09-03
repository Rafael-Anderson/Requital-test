import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { CreateBranchUserDto } from './dto/create-branch-user.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import {
  STAFF_ACCESS_COOKIE,
  STAFF_ACCESS_COOKIE_MAX_AGE_MS,
  STAFF_REFRESH_COOKIE,
  STAFF_REFRESH_PATH,
  staffCsrf,
} from './auth.constants';
import { sessionCookieOptions } from '../common/cookies';

// Session-cookie migration (security audit finding #1), phase 2 — every
// token-issuing method below sets the two staff cookies and mints a CSRF
// cookie instead of returning tokens in the JSON body, same shape as
// PlatformAuthController's own login/logout (phase 1). The one deliberate
// difference: in NODE_ENV=test, the raw tokens are ALSO still returned in
// the body — see AuthGuard.extractToken's own comment for why: this keeps
// ~60 existing e2e specs' `body<AuthResponse>(signup).accessToken`-style
// setup helpers working unchanged, since the token itself doesn't change
// shape, only its transport does. Never true outside Jest.
const isTest = process.env.NODE_ENV === 'test';

function setStaffSessionCookies(
  req: Request,
  res: Response,
  session: { accessToken: string; refreshToken: string | null },
) {
  res.cookie(
    STAFF_ACCESS_COOKIE,
    session.accessToken,
    sessionCookieOptions('/', STAFF_ACCESS_COOKIE_MAX_AGE_MS),
  );
  if (session.refreshToken) {
    res.cookie(
      STAFF_REFRESH_COOKIE,
      session.refreshToken,
      sessionCookieOptions(STAFF_REFRESH_PATH),
    );
  }
  staffCsrf.issue(req, res, session.accessToken);
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Tighter than the global 100/min default on every credential/token-issuing
  // or enumeration-sensitive endpoint below — 5/min/IP is generous for a
  // genuine user (a typo or two) but meaningfully slows down scripted
  // brute-force/credential-stuffing/token-guessing attempts.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.signup(dto);
    setStaffSessionCookies(req, res, session);
    // devVerificationLink is a sibling field on AuthService.signup's own
    // return, not nested under `user` — dropped here entirely the first
    // time this was written (isTest ? session : {user: session.user}
    // silently discarded it in every non-Jest environment, including a
    // real dev-mode backend), breaking e2e/seed.ts's own verify-email step
    // for real, caught running the Playwright suite locally. Unrelated to
    // the actual security boundary this isTest branch exists for (the raw
    // tokens): devVerificationLink is itself already gated by AuthService's
    // own isDev check (never present against a real production build), so
    // preserving it here unconditionally doesn't reintroduce anything.
    return isTest
      ? session
      : {
          user: session.user,
          ...(session.devVerificationLink
            ? { devVerificationLink: session.devVerificationLink }
            : {}),
        };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.login(dto);
    setStaffSessionCookies(req, res, session);
    return isTest ? session : { user: session.user };
  }

  // No access token exists to check yet when this is called (that's the
  // whole point — the old one just expired), so this has to be reachable
  // without one. The refresh token itself is the credential here, read from
  // its own narrowly-scoped cookie (Path=/auth/refresh) rather than a body
  // field — nothing else in the app ever sends that cookie.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken: unknown = req.cookies?.[STAFF_REFRESH_COOKIE];
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const session = await this.authService.refresh({ refreshToken });
    setStaffSessionCookies(req, res, session);
    return isTest ? session : { user: session.user };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken: unknown = req.cookies?.[STAFF_REFRESH_COOKIE];
    if (typeof refreshToken === 'string' && refreshToken) {
      await this.authService.logout({ refreshToken });
    }
    res.clearCookie(STAFF_ACCESS_COOKIE, sessionCookieOptions('/'));
    res.clearCookie(
      STAFF_REFRESH_COOKIE,
      sessionCookieOptions(STAFF_REFRESH_PATH),
    );
    return { success: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('accept-invite')
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.authService.acceptInvite(dto);
    setStaffSessionCookies(req, res, session);
    return isTest ? session : { user: session.user };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('resend-verification')
  resendVerification(@CurrentUser() ctx: TenantContext) {
    return this.authService.resendVerification(ctx);
  }

  // Also the bootstrap point for CSRF token distribution (see
  // common/csrf.ts's own top comment) — a fresh page load/new tab has no
  // in-memory CSRF value left over from login, so this hands one back via
  // the response header every time, reusing the existing cookie's value
  // rather than rotating it (a rotation here would silently invalidate the
  // token any other already-open tab is still holding).
  @Get('me')
  async me(
    @CurrentUser() ctx: TenantContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accessToken: unknown = req.cookies?.[STAFF_ACCESS_COOKIE];
    if (typeof accessToken === 'string' && accessToken) {
      staffCsrf.issue(req, res, accessToken, { reuseExisting: true });
    }
    return this.authService.me(ctx);
  }

  @Post('change-password')
  changePassword(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(ctx, dto);
  }

  @Roles('admin')
  @Post('branch-users')
  createBranchUser(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateBranchUserDto,
  ) {
    return this.authService.createBranchUser(ctx, dto);
  }

  @Roles('admin')
  @Get('users')
  listUsers(@CurrentUser() ctx: TenantContext) {
    return this.authService.listUsers(ctx);
  }

  @Roles('admin')
  @Patch('users/:id')
  updateStaffUser(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStaffUserDto,
  ) {
    return this.authService.updateStaffUser(ctx, id, dto);
  }

  @Roles('admin')
  @Delete('users/:id')
  deleteStaffUser(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.authService.deleteStaffUser(ctx, id);
  }
}
